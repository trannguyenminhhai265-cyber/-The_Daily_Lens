// Moderator tools: comment review queue, reports/flags and spam control.
const express = require('express');
const User = require('../models/User');
const Document = require('../models/Document');
const { Comment, Report } = require('../models/Engagement');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');
const { paginate, pageMeta, notFound, badRequest, isObjectId } = require('../utils/http');
const { escapeRegex } = require('../utils/text');
const { audit } = require('../utils/audit');
const { refreshCommentCount, AUTHOR_FIELDS } = require('../services/documents');

const router = express.Router();
const P = PERMISSIONS;
const COMMENT_STATUSES = ['visible', 'pending', 'hidden', 'spam'];

router.use(authenticate);

router.get('/stats', requirePermission(P.COMMENTS_MODERATE, P.REPORTS_HANDLE), async (_req, res) => {
  const [byStatus, openReports, mutedUsers] = await Promise.all([
    Comment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Report.countDocuments({ status: 'open' }),
    User.countDocuments({ is_muted: true }),
  ]);
  const comments = Object.fromEntries(COMMENT_STATUSES.map((s) => [s, 0]));
  byStatus.forEach((r) => (comments[r._id] = r.count));
  res.json({ comments, open_reports: openReports, muted_users: mutedUsers });
});

router.get('/comments', requirePermission(P.COMMENTS_MODERATE), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 20);
  const filter = {};
  if (COMMENT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) filter.content = new RegExp(escapeRegex(String(req.query.q)), 'i');
  if (req.query.flagged === 'true') filter.flags_count = { $gt: 0 };
  const [items, total] = await Promise.all([
    Comment.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user_id', `${AUTHOR_FIELDS} is_muted role`)
      .populate('document_id', 'title slug'),
    Comment.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

async function setCommentStatus(req, ids, status) {
  if (!COMMENT_STATUSES.includes(status)) throw badRequest('Invalid status');
  const comments = await Comment.find({ _id: { $in: ids } });
  for (const c of comments) {
    c.status = status;
    c.moderation_reason = `Set to ${status} by ${req.user.username}`;
    await c.save();
  }
  const docIds = [...new Set(comments.map((c) => String(c.document_id)))];
  await Promise.all(docIds.map((id) => refreshCommentCount(id)));
  await audit(req, 'comment.moderate', { target_type: 'comment', details: { ids, status } });
  return comments.length;
}

router.patch('/comments/:id', requirePermission(P.COMMENTS_MODERATE), async (req, res) => {
  const updated = await setCommentStatus(req, [req.params.id], req.body && req.body.status);
  if (!updated) throw notFound('Comment not found');
  res.json({ ok: true });
});

router.post('/comments/bulk', requirePermission(P.COMMENTS_MODERATE), async (req, res) => {
  const ids = ((req.body && req.body.ids) || []).filter(isObjectId);
  if (!ids.length) throw badRequest('No comments selected');
  const updated = await setCommentStatus(req, ids, req.body.status);
  res.json({ updated });
});

router.delete('/comments/:id', requirePermission(P.COMMENTS_MODERATE), async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw notFound('Comment not found');
  await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent_id: comment._id }] });
  await refreshCommentCount(comment.document_id);
  await audit(req, 'comment.delete', { target_type: 'comment', target_id: comment._id, level: 'warn' });
  res.json({ ok: true });
});

// ---- Reports / flags ----

router.get('/reports', requirePermission(P.REPORTS_HANDLE), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 20);
  const filter = {};
  if (['open', 'resolved', 'dismissed'].includes(req.query.status)) filter.status = req.query.status;
  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reporter_id', 'username display_name')
      .populate('handled_by', 'username display_name'),
    Report.countDocuments(filter),
  ]);

  // Attach a preview of the reported item.
  const commentIds = reports.filter((r) => r.target_type === 'comment').map((r) => r.target_id);
  const docIds = reports.filter((r) => r.target_type === 'document').map((r) => r.target_id);
  const [comments, docs] = await Promise.all([
    Comment.find({ _id: { $in: commentIds } })
      .populate('user_id', 'username display_name is_muted')
      .populate('document_id', 'title slug'),
    Document.find({ _id: { $in: docIds } }).select('title slug status'),
  ]);
  const byId = new Map([...comments, ...docs].map((t) => [String(t._id), t]));
  const items = reports.map((r) => ({ ...r.toJSON(), target: byId.get(String(r.target_id)) || null }));
  res.json({ items, ...pageMeta(total, page, limit) });
});

router.patch('/reports/:id', requirePermission(P.REPORTS_HANDLE), async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) throw notFound('Report not found');
  const { status, resolution_note, action } = req.body || {};
  if (!['open', 'resolved', 'dismissed'].includes(status)) throw badRequest('Invalid status');

  if (action === 'hide_target' && report.target_type === 'comment') {
    await setCommentStatus(req, [report.target_id], 'hidden');
  }
  if (action === 'mute_author' && report.target_type === 'comment') {
    const comment = await Comment.findById(report.target_id);
    if (comment) await User.updateOne({ _id: comment.user_id }, { is_muted: true });
  }

  report.status = status;
  report.resolution_note = resolution_note || '';
  report.handled_by = req.user._id;
  await report.save();
  await audit(req, 'report.handle', { target_type: 'report', target_id: report._id, details: { status, action } });
  res.json({ report });
});

// PATCH /api/moderation/users/:id/mute - stop a user from commenting (spam control).
router.patch('/users/:id/mute', requirePermission(P.COMMENTS_MODERATE), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.role !== 'user') throw badRequest('Staff accounts cannot be muted by moderators');
  user.is_muted = Boolean(req.body && req.body.is_muted);
  await user.save();
  await audit(req, user.is_muted ? 'user.mute' : 'user.unmute', { target_type: 'user', target_id: user._id });
  res.json({ user });
});

module.exports = router;

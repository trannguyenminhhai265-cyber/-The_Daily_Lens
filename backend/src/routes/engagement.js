// Comment deletion, content reports, public user profiles, mention lookup and click logging.
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Document = require('../models/Document');
const Setting = require('../models/Setting');
const { Comment, Report } = require('../models/Engagement');
const { SearchLog } = require('../models/Logs');
const { authenticate, optionalAuth, hasPermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');
const { badRequest, notFound, forbidden, isObjectId } = require('../utils/http');
const { escapeRegex } = require('../utils/text');
const { refreshCommentCount, AUTHOR_FIELDS, LIST_FIELDS, populateRefs } = require('../services/documents');

const router = express.Router();

// DELETE /api/comments/:id - authors can delete their own comments, moderators any comment.
router.delete('/comments/:id', authenticate, async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw notFound('Comment not found');
  const isOwner = String(comment.user_id) === String(req.user._id);
  if (!isOwner && !hasPermission(req.user, PERMISSIONS.COMMENTS_MODERATE)) throw forbidden();
  await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent_id: comment._id }] });
  await refreshCommentCount(comment.document_id);
  res.json({ ok: true });
});

// POST /api/reports - flag a comment or an article.
router.post('/reports', authenticate, async (req, res) => {
  const { target_type, target_id, reason, details } = req.body || {};
  if (!['comment', 'document'].includes(target_type)) throw badRequest('Invalid report target');
  if (!isObjectId(target_id)) throw badRequest('Invalid target id');

  const Model = target_type === 'comment' ? Comment : Document;
  const target = await Model.findById(target_id);
  if (!target) throw notFound('Reported item not found');

  const duplicate = await Report.exists({ target_id, reporter_id: req.user._id, status: 'open' });
  if (duplicate) throw badRequest('You have already reported this item');

  const report = await Report.create({ target_type, target_id, reporter_id: req.user._id, reason, details });

  if (target_type === 'comment') {
    target.flags_count += 1;
    const settings = await Setting.get();
    if (target.status === 'visible' && target.flags_count >= settings.auto_hide_flag_threshold) {
      target.status = 'pending';
      target.moderation_reason = `Auto-hidden after ${target.flags_count} reports`;
    }
    await target.save();
    await refreshCommentCount(target.document_id);
  }
  res.status(201).json({ report });
});

// GET /api/users/lookup?q= - username autocomplete for @mentions.
router.get('/users/lookup', authenticate, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ items: [] });
  const rx = new RegExp(`^${escapeRegex(q)}`, 'i');
  const items = await User.find({ status: 'active', $or: [{ username: rx }, { display_name: rx }] })
    .select('username display_name avatar_url')
    .limit(8);
  res.json({ items });
});

// GET /api/users/:username - public profile.
router.get('/users/:username', optionalAuth, async (req, res) => {
  const user = await User.findOne({ username: String(req.params.username).toLowerCase() });
  if (!user) throw notFound('User not found');

  const isSelf = req.user && String(req.user._id) === String(user._id);
  const commentFilter = isSelf ? { user_id: user._id } : { user_id: user._id, status: 'visible' };

  const [comments, mentions, articles, commentCount] = await Promise.all([
    Comment.find(commentFilter).sort({ created_at: -1 }).limit(20).populate('document_id', 'title slug'),
    Comment.find({ mentions: user._id, status: 'visible' })
      .sort({ created_at: -1 })
      .limit(10)
      .populate('document_id', 'title slug')
      .populate('user_id', AUTHOR_FIELDS),
    populateRefs(
      Document.find({ author: user._id, status: 'published' }).select(LIST_FIELDS).sort({ published_at: -1 }).limit(6)
    ),
    Comment.countDocuments({ user_id: user._id, status: 'visible' }),
  ]);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      bio: user.bio,
      avatar_url: user.avatar_url,
      role: user.role,
      created_at: user.created_at,
    },
    stats: { comments: commentCount, articles: articles.length },
    comments,
    mentions,
    articles,
  });
});

// POST /api/search/click - log a click on a search result (Phase 2 click-through data).
router.post('/search/click', optionalAuth, async (req, res) => {
  const { query_string, clicked_doc_id, position } = req.body || {};
  const query = String(query_string || '').trim().slice(0, 300);
  if (!query) throw badRequest('query_string is required');
  if (!isObjectId(clicked_doc_id) || !(await Document.exists({ _id: clicked_doc_id }))) {
    throw badRequest('clicked_doc_id is invalid');
  }
  await SearchLog.create({
    user_id: req.user ? req.user._id : null,
    query_string: query,
    clicked_doc_id: new mongoose.Types.ObjectId(String(clicked_doc_id)),
    event: 'click',
    position: Number.isInteger(position) ? position : null,
    session_id: String(req.headers['x-session-id'] || '').slice(0, 64),
  });
  res.status(201).json({ ok: true });
});

module.exports = router;

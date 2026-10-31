// Super Admin: user accounts, roles & permissions, system logs and global settings.
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Document = require('../models/Document');
const Setting = require('../models/Setting');
const { Comment, Like, Rating, Report } = require('../models/Engagement');
const { refreshCommentCount, refreshRating } = require('../services/documents');
const { SystemLog, SearchLog } = require('../models/Logs');
const { authenticate, requirePermission, serializeUser } = require('../middleware/auth');
const { PERMISSIONS, PERMISSION_LABELS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS } = require('../config/roles');
const { paginate, pageMeta, notFound, badRequest } = require('../utils/http');
const { escapeRegex } = require('../utils/text');
const { audit } = require('../utils/audit');
const { validatePassword } = require('./auth');

const router = express.Router();
const P = PERMISSIONS;

// GET /api/settings/public - settings the public UI needs (no auth).
router.get('/settings/public', async (_req, res) => {
  const s = await Setting.get();
  res.json({
    settings: {
      site_name: s.site_name,
      tagline: s.tagline,
      items_per_page: s.items_per_page,
      allow_registration: s.allow_registration,
      comment_policy: s.comment_policy,
      footer_text: s.footer_text,
    },
  });
});

router.use('/admin', authenticate);

router.get('/admin/meta', (_req, res) => {
  res.json({
    roles: Object.values(ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r] })),
    permissions: Object.values(PERMISSIONS).map((p) => ({ value: p, label: PERMISSION_LABELS[p] })),
  });
});

// ---- Users ----

router.get('/admin/users', requirePermission(P.USERS_MANAGE), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 20);
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [{ username: rx }, { email: rx }, { display_name: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: users.map(serializeUser), ...pageMeta(total, page, limit) });
});

router.post('/admin/users', requirePermission(P.USERS_MANAGE), async (req, res) => {
  const { username, email, password, display_name, role = ROLES.USER, permissions = [] } = req.body || {};
  if (!username || !email || !password) throw badRequest('Username, email and password are required');
  validatePassword(password);
  const user = new User({ username, email, display_name: display_name || username, role, permissions });
  await user.setPassword(password);
  await user.save();
  await audit(req, 'user.create', { target_type: 'user', target_id: user._id, details: { username, role } });
  res.status(201).json({ user: serializeUser(user) });
});

router.patch('/admin/users/:id', requirePermission(P.USERS_MANAGE), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  const isSelf = String(user._id) === String(req.user._id);
  const { role, permissions, status, is_muted, display_name, email, password } = req.body || {};

  if (isSelf && ((role && role !== user.role) || (status && status !== 'active'))) {
    throw badRequest('You cannot change your own role or suspend your own account');
  }
  const changes = {};
  if (role !== undefined) {
    if (!Object.values(ROLES).includes(role)) throw badRequest('Invalid role');
    changes.role = [user.role, role];
    user.role = role;
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) throw badRequest('permissions must be an array');
    changes.permissions = permissions;
    user.permissions = permissions;
  }
  if (status !== undefined) {
    changes.status = status;
    user.status = status;
  }
  if (is_muted !== undefined) user.is_muted = Boolean(is_muted);
  if (display_name !== undefined) user.display_name = display_name;
  if (email !== undefined) user.email = email;
  if (password) {
    validatePassword(password);
    await user.setPassword(password);
    changes.password = 'reset';
  }
  await user.save();
  await audit(req, 'user.update', { target_type: 'user', target_id: user._id, details: { username: user.username, ...changes } });
  res.json({ user: serializeUser(user) });
});

router.delete('/admin/users/:id', requirePermission(P.USERS_MANAGE), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (String(user._id) === String(req.user._id)) throw badRequest('You cannot delete your own account');
  if (await Document.exists({ author: user._id })) {
    throw badRequest('This user is the author of articles. Suspend the account instead of deleting it.');
  }
  // Remove the user's engagement and refresh the affected article counters.
  const [comments, likes, ratings] = await Promise.all([
    Comment.find({ user_id: user._id }).select('_id document_id'),
    Like.find({ user_id: user._id }).select('document_id'),
    Rating.find({ user_id: user._id }).select('document_id'),
  ]);
  await Promise.all([
    Comment.deleteMany({ $or: [{ user_id: user._id }, { parent_id: { $in: comments.map((c) => c._id) } }] }),
    Like.deleteMany({ user_id: user._id }),
    Rating.deleteMany({ user_id: user._id }),
    Report.deleteMany({ reporter_id: user._id }),
  ]);
  const docIds = new Set([...comments, ...likes, ...ratings].map((x) => String(x.document_id)));
  for (const id of docIds) {
    await refreshCommentCount(id);
    await refreshRating(new mongoose.Types.ObjectId(id));
    await Document.updateOne({ _id: id }, { likes_count: await Like.countDocuments({ document_id: id }) });
  }
  await user.deleteOne();
  await audit(req, 'user.delete', { target_type: 'user', target_id: user._id, level: 'warn', details: { username: user.username } });
  res.json({ ok: true });
});

// ---- Logs ----

router.get('/admin/logs', requirePermission(P.LOGS_VIEW), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 30);
  const filter = {};
  if (req.query.level) filter.level = req.query.level;
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(String(req.query.action))}`, 'i');
  if (req.query.actor) filter.actor_name = String(req.query.actor).toLowerCase();
  const [items, total] = await Promise.all([
    SystemLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
    SystemLog.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

router.get('/admin/search-logs', requirePermission(P.LOGS_VIEW, P.ANALYTICS_VIEW), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 30);
  const filter = {};
  if (req.query.event) filter.event = req.query.event;
  if (req.query.q) filter.query_string = new RegExp(escapeRegex(String(req.query.q)), 'i');
  const [items, total] = await Promise.all([
    SearchLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user_id', 'username')
      .populate('clicked_doc_id', 'title slug'),
    SearchLog.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

// ---- Settings ----

router.get('/admin/settings', requirePermission(P.SETTINGS_MANAGE), async (_req, res) => {
  res.json({ settings: await Setting.get() });
});

router.put('/admin/settings', requirePermission(P.SETTINGS_MANAGE), async (req, res) => {
  const allowed = [
    'site_name',
    'tagline',
    'items_per_page',
    'allow_registration',
    'comment_policy',
    'banned_words',
    'max_links_per_comment',
    'auto_hide_flag_threshold',
    'footer_text',
  ];
  const update = {};
  for (const key of allowed) if (req.body[key] !== undefined) update[key] = req.body[key];
  if (typeof update.banned_words === 'string') {
    update.banned_words = update.banned_words.split(',').map((w) => w.trim()).filter(Boolean);
  }
  const settings = await Setting.findOneAndUpdate({ key: 'global' }, update, {
    new: true,
    upsert: true,
    runValidators: true,
  });
  Setting.invalidate();
  await audit(req, 'settings.update', { target_type: 'settings', details: update });
  res.json({ settings });
});

module.exports = router;

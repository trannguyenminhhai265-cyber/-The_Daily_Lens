const express = require('express');
const Document = require('../models/Document');
const Setting = require('../models/Setting');
const User = require('../models/User');
const { Comment, Like, Rating } = require('../models/Engagement');
const { SearchLog, InteractionLog } = require('../models/Logs');
const { optionalAuth, authenticate, hasPermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');
const { paginate, pageMeta, notFound, badRequest, forbidden, isObjectId } = require('../utils/http');
const { extractMentions, countLinks } = require('../utils/text');
const {
  AUTHOR_FIELDS,
  LIST_FIELDS,
  populateRefs,
  buildDocumentFilter,
  sortFor,
  refreshCommentCount,
  refreshRating,
} = require('../services/documents');

const router = express.Router();

const sessionId = (req) => String(req.headers['x-session-id'] || '').slice(0, 64);

async function findPublished(idOrSlug) {
  const query = isObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug };
  const doc = await Document.findOne({ ...query, status: 'published' });
  if (!doc) throw notFound('Article not found');
  return doc;
}

// GET /api/documents - paginated list with keyword search and filters.
router.get('/', optionalAuth, async (req, res) => {
  const settings = await Setting.get();
  const { page, limit, skip } = paginate(req.query, settings.items_per_page, 50);
  const { filter, q } = await buildDocumentFilter(req.query, { status: 'published' });
  if (req.query.featured === 'true') filter.is_featured = true;

  const [items, total] = await Promise.all([
    populateRefs(Document.find(filter).select(LIST_FIELDS).sort(sortFor(req.query.sort)).skip(skip).limit(limit)),
    Document.countDocuments(filter),
  ]);

  // Search log (Phase 2): record every keyword search once, on its first page.
  if (q && page === 1 && req.query.log !== 'false') {
    SearchLog.create({
      user_id: req.user ? req.user._id : null,
      query_string: q,
      clicked_doc_id: null,
      event: 'search',
      session_id: sessionId(req),
      results_count: total,
      filters: {
        category: req.query.category || null,
        tag: req.query.tag || null,
        from: req.query.from || null,
        to: req.query.to || null,
        sort: req.query.sort || 'latest',
      },
    }).catch((err) => console.error('[search-log]', err.message));
  }

  res.json({ items, ...pageMeta(total, page, limit) });
});

// GET /api/documents/:slug - full article. Increments the view counter.
router.get('/:slug', optionalAuth, async (req, res) => {
  const doc = await findPublished(req.params.slug);

  doc.views_count += 1;
  await Document.updateOne({ _id: doc._id }, { $inc: { views_count: 1 } });
  InteractionLog.create({
    user_id: req.user ? req.user._id : null,
    session_id: sessionId(req),
    doc_id: doc._id,
    action: 'view',
  }).catch(() => {});

  await doc.populate([
    { path: 'category_id', select: 'name slug color' },
    { path: 'tags', select: 'name slug' },
    { path: 'author', select: `${AUTHOR_FIELDS} bio` },
  ]);

  const [related, liked, rating] = await Promise.all([
    populateRefs(
      Document.find({ status: 'published', category_id: doc.category_id._id, _id: { $ne: doc._id } })
        .select(LIST_FIELDS)
        .sort({ published_at: -1 })
        .limit(4)
    ),
    req.user ? Like.exists({ user_id: req.user._id, document_id: doc._id }) : null,
    req.user ? Rating.findOne({ user_id: req.user._id, document_id: doc._id }) : null,
  ]);

  res.json({
    document: doc,
    related,
    viewer: { liked: Boolean(liked), rating: rating ? rating.value : 0 },
  });
});

// POST /api/documents/:id/like - toggle like.
router.post('/:id/like', authenticate, async (req, res) => {
  const doc = await findPublished(req.params.id);
  const removed = await Like.findOneAndDelete({ user_id: req.user._id, document_id: doc._id });
  if (!removed) await Like.create({ user_id: req.user._id, document_id: doc._id });
  const likes_count = await Like.countDocuments({ document_id: doc._id });
  await Document.updateOne({ _id: doc._id }, { likes_count });
  InteractionLog.create({
    user_id: req.user._id,
    session_id: sessionId(req),
    doc_id: doc._id,
    action: removed ? 'unlike' : 'like',
  }).catch(() => {});
  res.json({ liked: !removed, likes_count });
});

// POST /api/documents/:id/rate - rate 1..5 stars.
router.post('/:id/rate', authenticate, async (req, res) => {
  const value = Number(req.body && req.body.value);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw badRequest('Rating must be an integer from 1 to 5');
  const doc = await findPublished(req.params.id);
  await Rating.findOneAndUpdate(
    { user_id: req.user._id, document_id: doc._id },
    { value },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const summary = await refreshRating(doc._id);
  InteractionLog.create({
    user_id: req.user._id,
    session_id: sessionId(req),
    doc_id: doc._id,
    action: 'rate',
    value,
  }).catch(() => {});
  res.json({ rating: value, ...summary });
});

// GET /api/documents/:id/comments - visible comments (plus the viewer's own pending ones).
router.get('/:id/comments', optionalAuth, async (req, res) => {
  const doc = await findPublished(req.params.id);
  const or = [{ status: 'visible' }];
  if (req.user) or.push({ user_id: req.user._id, status: 'pending' });
  const comments = await Comment.find({ document_id: doc._id, $or: or })
    .sort({ created_at: 1 })
    .limit(500)
    .populate('user_id', AUTHOR_FIELDS)
    .populate('mentions', 'username display_name');
  res.json({ items: comments });
});

// POST /api/documents/:id/comments - add a comment or a reply.
router.post('/:id/comments', authenticate, async (req, res) => {
  if (req.user.is_muted) throw forbidden('Your account has been muted by a moderator');
  const doc = await findPublished(req.params.id);
  const content = String((req.body && req.body.content) || '').trim();
  if (!content) throw badRequest('Comment cannot be empty');
  if (content.length > 2000) throw badRequest('Comment is too long (max 2000 characters)');

  let parent_id = null;
  if (req.body.parent_id) {
    const parent = await Comment.findOne({ _id: req.body.parent_id, document_id: doc._id });
    if (!parent) throw badRequest('Parent comment not found');
    parent_id = parent.parent_id || parent._id; // keep a single level of nesting
  }

  // Spam control.
  const settings = await Setting.get();
  let status = settings.comment_policy === 'approval' ? 'pending' : 'visible';
  let moderation_reason = status === 'pending' ? 'Awaiting approval' : '';
  const lower = content.toLowerCase();
  const banned = (settings.banned_words || []).find((w) => w && lower.includes(w));
  if (banned) {
    status = 'pending';
    moderation_reason = `Contains blocked word "${banned}"`;
  }
  if (countLinks(content) > settings.max_links_per_comment) {
    status = 'spam';
    moderation_reason = 'Too many links';
  }

  // User tagging via @username.
  const usernames = extractMentions(content);
  const mentioned = usernames.length ? await User.find({ username: { $in: usernames } }).select('_id') : [];

  const comment = await Comment.create({
    document_id: doc._id,
    user_id: req.user._id,
    parent_id,
    content,
    mentions: mentioned.map((u) => u._id),
    status,
    moderation_reason,
  });
  await refreshCommentCount(doc._id);
  InteractionLog.create({ user_id: req.user._id, session_id: sessionId(req), doc_id: doc._id, action: 'comment' }).catch(
    () => {}
  );

  await comment.populate([
    { path: 'user_id', select: AUTHOR_FIELDS },
    { path: 'mentions', select: 'username display_name' },
  ]);
  res.status(201).json({ comment });
});

module.exports = router;
module.exports.findPublished = findPublished;
module.exports.canModerate = (user) => hasPermission(user, PERMISSIONS.COMMENTS_MODERATE);

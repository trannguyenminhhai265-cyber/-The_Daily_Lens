// Admin content management: articles CRUD (Content Manager) and SEO metadata (SEO Specialist).
const express = require('express');
const Document = require('../models/Document');
const { Comment, Like, Rating, Report } = require('../models/Engagement');
const { authenticate, requirePermission, hasPermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');
const { paginate, pageMeta, notFound } = require('../utils/http');
const { audit } = require('../utils/audit');
const {
  LIST_FIELDS,
  populateRefs,
  buildDocumentFilter,
  sortFor,
  applyDocumentInput,
  applySeo,
  setStatus,
} = require('../services/documents');

const router = express.Router();
const P = PERMISSIONS;

router.use(authenticate);

async function loadDocument(id) {
  const doc = await Document.findById(id);
  if (!doc) throw notFound('Article not found');
  return doc;
}

// GET /api/manage/documents - every article regardless of status.
router.get('/documents', requirePermission(P.CONTENT_MANAGE, P.SEO_MANAGE), async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 15);
  const { filter } = await buildDocumentFilter(req.query);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.seo === 'missing') {
    filter.$or = [{ 'seo.meta_description': '' }, { 'seo.meta_title': '' }, { 'cover_image.alt': '' }];
  }
  const sort = req.query.sort ? sortFor(req.query.sort) : { updated_at: -1 };
  const [items, total] = await Promise.all([
    populateRefs(Document.find(filter).select(LIST_FIELDS).sort(sort).skip(skip).limit(limit)),
    Document.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

router.get('/documents/:id', requirePermission(P.CONTENT_MANAGE, P.SEO_MANAGE), async (req, res) => {
  const doc = await populateRefs(Document.findById(req.params.id));
  if (!doc) throw notFound('Article not found');
  res.json({ document: doc });
});

router.post('/documents', requirePermission(P.CONTENT_MANAGE), async (req, res) => {
  const doc = new Document({ author: req.user._id, status: 'draft' });
  await applyDocumentInput(doc, req.body || {}, { canPublish: hasPermission(req.user, P.CONTENT_PUBLISH) });
  await doc.save();
  await audit(req, 'document.create', { target_type: 'document', target_id: doc._id, details: { title: doc.title } });
  res.status(201).json({ document: doc });
});

router.put('/documents/:id', requirePermission(P.CONTENT_MANAGE), async (req, res) => {
  const doc = await loadDocument(req.params.id);
  await applyDocumentInput(doc, req.body || {}, { canPublish: hasPermission(req.user, P.CONTENT_PUBLISH) });
  await doc.save();
  await audit(req, 'document.update', { target_type: 'document', target_id: doc._id, details: { title: doc.title } });
  res.json({ document: doc });
});

// PATCH /api/manage/documents/:id/status - publish / unpublish / archive.
router.patch('/documents/:id/status', requirePermission(P.CONTENT_PUBLISH), async (req, res) => {
  const doc = await loadDocument(req.params.id);
  setStatus(doc, req.body && req.body.status);
  await doc.save();
  await audit(req, `document.${doc.status}`, { target_type: 'document', target_id: doc._id, details: { title: doc.title } });
  res.json({ document: doc });
});

// PATCH /api/manage/documents/:id/seo - SEO metadata and image alt text.
router.patch('/documents/:id/seo', requirePermission(P.SEO_MANAGE), async (req, res) => {
  const doc = await loadDocument(req.params.id);
  const body = req.body || {};
  applySeo(doc, body.seo || body);
  if (body.cover_alt !== undefined) doc.cover_image.alt = String(body.cover_alt).slice(0, 200);
  await doc.save();
  await audit(req, 'document.seo_update', { target_type: 'document', target_id: doc._id, details: { title: doc.title } });
  res.json({ document: doc });
});

router.delete('/documents/:id', requirePermission(P.CONTENT_MANAGE), async (req, res) => {
  const doc = await loadDocument(req.params.id);
  const commentIds = (await Comment.find({ document_id: doc._id }).select('_id')).map((c) => c._id);
  await Promise.all([
    Comment.deleteMany({ document_id: doc._id }),
    Like.deleteMany({ document_id: doc._id }),
    Rating.deleteMany({ document_id: doc._id }),
    Report.deleteMany({ target_id: { $in: [doc._id, ...commentIds] } }),
  ]);
  await doc.deleteOne();
  await audit(req, 'document.delete', { target_type: 'document', target_id: doc._id, level: 'warn', details: { title: doc.title } });
  res.json({ ok: true });
});

module.exports = router;

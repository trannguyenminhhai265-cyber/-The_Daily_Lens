const express = require('express');
const Document = require('../models/Document');
const { Category, Tag } = require('../models/Taxonomy');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');
const { badRequest, notFound, HttpError } = require('../utils/http');
const { slugify } = require('../utils/text');
const { audit } = require('../utils/audit');

const router = express.Router();
const canManage = [authenticate, requirePermission(PERMISSIONS.TAXONOMY_MANAGE)];

async function countsBy(field) {
  const rows = await Document.aggregate([
    { $match: { status: 'published' } },
    { $unwind: `$${field}` },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

// ---- Categories ----

router.get('/categories', async (_req, res) => {
  const [categories, counts] = await Promise.all([Category.find().sort({ name: 1 }), countsBy('category_id')]);
  res.json({ items: categories.map((c) => ({ ...c.toJSON(), count: counts.get(String(c._id)) || 0 })) });
});

router.post('/categories', ...canManage, async (req, res) => {
  const { name, description, color } = req.body || {};
  if (!name) throw badRequest('Category name is required');
  const category = await Category.create({ name, description, color, slug: req.body.slug || slugify(name) });
  await audit(req, 'category.create', { target_type: 'category', target_id: category._id, details: { name } });
  res.status(201).json({ category });
});

router.put('/categories/:id', ...canManage, async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw notFound('Category not found');
  const { name, description, color, slug } = req.body || {};
  if (name !== undefined) category.name = name;
  if (description !== undefined) category.description = description;
  if (color !== undefined) category.color = color;
  if (slug !== undefined) category.slug = slugify(slug);
  await category.save();
  await audit(req, 'category.update', { target_type: 'category', target_id: category._id });
  res.json({ category });
});

router.delete('/categories/:id', ...canManage, async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw notFound('Category not found');
  const inUse = await Document.countDocuments({ category_id: category._id });
  if (inUse) {
    const target = req.query.reassign_to;
    if (!target || !(await Category.exists({ _id: target }))) {
      throw new HttpError(409, `This category is used by ${inUse} article(s). Choose a category to move them to.`);
    }
    await Document.updateMany({ category_id: category._id }, { category_id: target });
  }
  await category.deleteOne();
  await audit(req, 'category.delete', { target_type: 'category', target_id: category._id, details: { name: category.name } });
  res.json({ ok: true });
});

// ---- Tags ----

router.get('/tags', async (_req, res) => {
  const [tags, counts] = await Promise.all([Tag.find().sort({ name: 1 }), countsBy('tags')]);
  res.json({ items: tags.map((t) => ({ ...t.toJSON(), count: counts.get(String(t._id)) || 0 })) });
});

router.post('/tags', ...canManage, async (req, res) => {
  const { name } = req.body || {};
  if (!name) throw badRequest('Tag name is required');
  const tag = await Tag.create({ name, slug: slugify(name) });
  await audit(req, 'tag.create', { target_type: 'tag', target_id: tag._id, details: { name } });
  res.status(201).json({ tag });
});

router.put('/tags/:id', ...canManage, async (req, res) => {
  const tag = await Tag.findById(req.params.id);
  if (!tag) throw notFound('Tag not found');
  if (req.body.name) {
    tag.name = req.body.name;
    tag.slug = slugify(req.body.name);
  }
  await tag.save();
  await audit(req, 'tag.update', { target_type: 'tag', target_id: tag._id });
  res.json({ tag });
});

router.delete('/tags/:id', ...canManage, async (req, res) => {
  const tag = await Tag.findById(req.params.id);
  if (!tag) throw notFound('Tag not found');
  await Document.updateMany({ tags: tag._id }, { $pull: { tags: tag._id } });
  await tag.deleteOne();
  await audit(req, 'tag.delete', { target_type: 'tag', target_id: tag._id, details: { name: tag.name } });
  res.json({ ok: true });
});

module.exports = router;

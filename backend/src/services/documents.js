const Document = require('../models/Document');
const { Category, Tag } = require('../models/Taxonomy');
const { Comment, Rating } = require('../models/Engagement');
const { escapeRegex, slugify, sanitizeContent, htmlToText, readingTime } = require('../utils/text');
const { badRequest, isObjectId } = require('../utils/http');

const AUTHOR_FIELDS = 'username display_name avatar_url';
const LIST_FIELDS = '-content -content_text';

function populateRefs(query) {
  return query
    .populate('category_id', 'name slug color')
    .populate('tags', 'name slug')
    .populate('author', AUTHOR_FIELDS);
}

/**
 * Builds a MongoDB filter from query-string parameters.
 * Keyword search (Phase 1 placeholder) uses case-insensitive regular expressions: every
 * term must appear in the title, summary or plain-text content (SQL "LIKE %term%").
 */
async function buildDocumentFilter(query, base = {}) {
  const filter = { ...base };
  const and = [];
  const q = String(query.q || '').trim().slice(0, 200);

  if (q) {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const term of terms) {
      const rx = new RegExp(escapeRegex(term), 'i');
      and.push({ $or: [{ title: rx }, { summary: rx }, { content_text: rx }] });
    }
  }

  if (query.category) {
    const cat = isObjectId(query.category)
      ? await Category.findById(query.category)
      : await Category.findOne({ slug: query.category });
    filter.category_id = cat ? cat._id : null;
  }

  if (query.tag) {
    const tag = isObjectId(query.tag) ? await Tag.findById(query.tag) : await Tag.findOne({ slug: query.tag });
    filter.tags = tag ? tag._id : null;
  }

  const dateField = base.status === 'published' ? 'published_at' : 'created_at';
  const range = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  if (Object.keys(range).length) filter[dateField] = range;

  if (query.author && isObjectId(query.author)) filter.author = query.author;
  if (and.length) filter.$and = and;
  return { filter, q };
}

function sortFor(sort) {
  switch (sort) {
    case 'popular':
      return { views_count: -1, published_at: -1 };
    case 'top_rated':
      return { rating_avg: -1, rating_count: -1 };
    case 'oldest':
      return { published_at: 1, created_at: 1 };
    default:
      return { published_at: -1, created_at: -1 };
  }
}

/** Finds tags by name, creating the missing ones. Returns their ids. */
async function resolveTags(tags) {
  if (!tags) return [];
  const names = (Array.isArray(tags) ? tags : String(tags).split(','))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 15);
  const ids = [];
  for (const name of names) {
    if (isObjectId(name)) {
      ids.push(name);
      continue;
    }
    const slug = slugify(name);
    if (!slug) continue;
    const tag = await Tag.findOneAndUpdate(
      { slug },
      { $setOnInsert: { name, slug } },
      { new: true, upsert: true }
    );
    ids.push(tag._id);
  }
  return [...new Set(ids.map(String))];
}

async function uniqueSlug(title, excludeId) {
  const base = slugify(title) || 'article';
  let slug = base;
  for (let i = 2; await Document.exists({ slug, _id: { $ne: excludeId } }); i += 1) slug = `${base}-${i}`;
  return slug;
}

/** Applies editable article fields from a request body onto a Document. */
async function applyDocumentInput(doc, body, { canPublish }) {
  const { title, summary, content, category_id, tags, cover_image, is_featured, status, seo } = body;

  if (title !== undefined) {
    doc.title = title;
    if (!doc.slug || body.regenerate_slug) doc.slug = await uniqueSlug(title, doc._id);
  }
  if (body.slug) doc.slug = await uniqueSlug(body.slug, doc._id);
  if (summary !== undefined) doc.summary = summary;
  if (content !== undefined) {
    doc.content = sanitizeContent(content);
    doc.content_text = htmlToText(doc.content);
    doc.reading_time = readingTime(doc.content_text);
  }
  if (category_id !== undefined) {
    if (!isObjectId(category_id) || !(await Category.exists({ _id: category_id }))) {
      throw badRequest('Please choose a valid category');
    }
    doc.category_id = category_id;
  }
  if (tags !== undefined) doc.tags = await resolveTags(tags);
  if (cover_image !== undefined) {
    doc.cover_image = {
      url: cover_image.url || '',
      alt: cover_image.alt || '',
      caption: cover_image.caption || '',
    };
  }
  if (is_featured !== undefined) doc.is_featured = Boolean(is_featured);
  if (seo !== undefined) applySeo(doc, seo);
  if (status !== undefined && status !== doc.status) {
    if (!canPublish && (status === 'published' || doc.status === 'published')) {
      throw badRequest('You are not allowed to change the publication status');
    }
    setStatus(doc, status);
  }
}

function setStatus(doc, status) {
  if (!['draft', 'published', 'archived'].includes(status)) throw badRequest('Invalid status');
  doc.status = status;
  if (status === 'published' && !doc.published_at) doc.published_at = new Date();
}

function applySeo(doc, seo = {}) {
  const current = doc.seo || {};
  doc.seo = {
    meta_title: seo.meta_title !== undefined ? String(seo.meta_title).slice(0, 70) : current.meta_title,
    meta_description:
      seo.meta_description !== undefined ? String(seo.meta_description).slice(0, 170) : current.meta_description,
    keywords:
      seo.keywords !== undefined
        ? (Array.isArray(seo.keywords) ? seo.keywords : String(seo.keywords).split(','))
            .map((k) => String(k).trim())
            .filter(Boolean)
            .slice(0, 20)
        : current.keywords,
    canonical_url: seo.canonical_url !== undefined ? seo.canonical_url : current.canonical_url,
  };
}

async function refreshCommentCount(documentId) {
  const count = await Comment.countDocuments({ document_id: documentId, status: 'visible' });
  await Document.updateOne({ _id: documentId }, { comments_count: count });
  return count;
}

async function refreshRating(documentId) {
  const [agg] = await Rating.aggregate([
    { $match: { document_id: documentId } },
    { $group: { _id: null, avg: { $avg: '$value' }, count: { $sum: 1 } } },
  ]);
  const rating_avg = agg ? Math.round(agg.avg * 10) / 10 : 0;
  const rating_count = agg ? agg.count : 0;
  await Document.updateOne({ _id: documentId }, { rating_avg, rating_count });
  return { rating_avg, rating_count };
}

module.exports = {
  AUTHOR_FIELDS,
  LIST_FIELDS,
  populateRefs,
  buildDocumentFilter,
  sortFor,
  resolveTags,
  uniqueSlug,
  applyDocumentInput,
  applySeo,
  setStatus,
  refreshCommentCount,
  refreshRating,
};

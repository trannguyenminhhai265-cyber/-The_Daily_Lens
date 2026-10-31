const mongoose = require('mongoose');
const { timestamps, toJSONPlugin } = require('./plugins');

/**
 * Documents collection - the Document Data Store used by the portal and, in Phase 2,
 * by the search engine (tokenization, inverted index, BM25 / TF-IDF).
 *
 * Phase 2 required fields: id (_id), title, content, summary, category_id, tags, author,
 * created_at, views_count. `content_text` keeps a plain-text copy of `content` so the
 * indexer does not need to strip HTML itself.
 */
const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true },
    summary: { type: String, required: true, trim: true, maxlength: 600 },
    content: { type: String, required: true }, // sanitized HTML
    content_text: { type: String, default: '' }, // plain text derived from content
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag', index: true }],
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    published_at: { type: Date, index: true },
    cover_image: {
      url: { type: String, default: '' },
      alt: { type: String, default: '' },
      caption: { type: String, default: '' },
    },
    seo: {
      meta_title: { type: String, default: '', maxlength: 70 },
      meta_description: { type: String, default: '', maxlength: 170 },
      keywords: [{ type: String, trim: true }],
      canonical_url: { type: String, default: '' },
    },
    reading_time: { type: Number, default: 1 }, // minutes
    views_count: { type: Number, default: 0 },
    likes_count: { type: Number, default: 0 },
    comments_count: { type: Number, default: 0 },
    rating_avg: { type: Number, default: 0 },
    rating_count: { type: Number, default: 0 },
    is_featured: { type: Boolean, default: false },
  },
  { timestamps, collection: 'documents' }
);

documentSchema.index({ status: 1, published_at: -1 });
documentSchema.index({ created_at: -1 });
documentSchema.plugin(toJSONPlugin);

module.exports = mongoose.model('Document', documentSchema);

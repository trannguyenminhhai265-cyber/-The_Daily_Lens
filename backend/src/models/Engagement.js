const mongoose = require('mongoose');
const { timestamps, toJSONPlugin } = require('./plugins');

const { ObjectId } = mongoose.Schema.Types;

const commentSchema = new mongoose.Schema(
  {
    document_id: { type: ObjectId, ref: 'Document', required: true, index: true },
    user_id: { type: ObjectId, ref: 'User', required: true, index: true },
    parent_id: { type: ObjectId, ref: 'Comment', default: null },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    // Users tagged with @username inside the comment.
    mentions: [{ type: ObjectId, ref: 'User', index: true }],
    status: { type: String, enum: ['visible', 'pending', 'hidden', 'spam'], default: 'visible', index: true },
    moderation_reason: { type: String, default: '' },
    flags_count: { type: Number, default: 0 },
  },
  { timestamps }
);
commentSchema.plugin(toJSONPlugin);

const likeSchema = new mongoose.Schema(
  {
    user_id: { type: ObjectId, ref: 'User', required: true },
    document_id: { type: ObjectId, ref: 'Document', required: true },
  },
  { timestamps }
);
likeSchema.index({ user_id: 1, document_id: 1 }, { unique: true });
likeSchema.plugin(toJSONPlugin);

const ratingSchema = new mongoose.Schema(
  {
    user_id: { type: ObjectId, ref: 'User', required: true },
    document_id: { type: ObjectId, ref: 'Document', required: true },
    value: { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps }
);
ratingSchema.index({ user_id: 1, document_id: 1 }, { unique: true });
ratingSchema.plugin(toJSONPlugin);

const reportSchema = new mongoose.Schema(
  {
    target_type: { type: String, enum: ['comment', 'document'], required: true },
    target_id: { type: ObjectId, required: true, index: true },
    reporter_id: { type: ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ['spam', 'abuse', 'misinformation', 'offensive', 'other'], required: true },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
    handled_by: { type: ObjectId, ref: 'User' },
    resolution_note: { type: String, default: '' },
  },
  { timestamps }
);
reportSchema.plugin(toJSONPlugin);

module.exports = {
  Comment: mongoose.model('Comment', commentSchema),
  Like: mongoose.model('Like', likeSchema),
  Rating: mongoose.model('Rating', ratingSchema),
  Report: mongoose.model('Report', reportSchema),
};

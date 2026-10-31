const mongoose = require('mongoose');
const { toJSONPlugin } = require('./plugins');

const { ObjectId, Mixed } = mongoose.Schema.Types;

/**
 * Search & Click Log (Phase 2 training / evaluation data).
 * Required fields: user_id, query_string, clicked_doc_id, timestamp.
 *  - A search event is stored with clicked_doc_id = null.
 *  - A click on a search result is stored with the same query_string and the clicked document.
 */
const searchLogSchema = new mongoose.Schema(
  {
    user_id: { type: ObjectId, ref: 'User', default: null, index: true },
    query_string: { type: String, required: true, trim: true, maxlength: 300 },
    clicked_doc_id: { type: ObjectId, ref: 'Document', default: null, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    session_id: { type: String, default: '' },
    event: { type: String, enum: ['search', 'click'], default: 'search' },
    results_count: { type: Number, default: null },
    position: { type: Number, default: null }, // rank of the clicked result (1-based)
    filters: { type: Mixed, default: {} },
  },
  { collection: 'search_logs' }
);
searchLogSchema.plugin(toJSONPlugin);

/** Standardized user interaction log (views, likes, ratings, comments). */
const interactionLogSchema = new mongoose.Schema(
  {
    user_id: { type: ObjectId, ref: 'User', default: null, index: true },
    session_id: { type: String, default: '' },
    doc_id: { type: ObjectId, ref: 'Document', required: true, index: true },
    action: { type: String, enum: ['view', 'like', 'unlike', 'rate', 'comment'], required: true, index: true },
    value: { type: Number, default: null },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { collection: 'interaction_logs' }
);
interactionLogSchema.plugin(toJSONPlugin);

/** Audit trail of administrative and security-relevant actions. */
const systemLogSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info', index: true },
    action: { type: String, required: true, index: true },
    actor_id: { type: ObjectId, ref: 'User', default: null },
    actor_name: { type: String, default: 'system' },
    target_type: { type: String, default: '' },
    target_id: { type: String, default: '' },
    details: { type: Mixed, default: {} },
    ip: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { collection: 'system_logs' }
);
systemLogSchema.plugin(toJSONPlugin);

module.exports = {
  SearchLog: mongoose.model('SearchLog', searchLogSchema),
  InteractionLog: mongoose.model('InteractionLog', interactionLogSchema),
  SystemLog: mongoose.model('SystemLog', systemLogSchema),
};

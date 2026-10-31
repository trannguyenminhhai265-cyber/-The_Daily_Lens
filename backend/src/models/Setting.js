const mongoose = require('mongoose');
const { timestamps, toJSONPlugin } = require('./plugins');

// Global site configuration, stored as a single document with key "global".
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    site_name: { type: String, default: 'The Daily Lens' },
    tagline: { type: String, default: 'Independent stories on technology, science, culture and the world' },
    items_per_page: { type: Number, default: 9, min: 3, max: 50 },
    allow_registration: { type: Boolean, default: true },
    // "open": comments appear immediately, "approval": every comment waits for a moderator.
    comment_policy: { type: String, enum: ['open', 'approval'], default: 'open' },
    banned_words: [{ type: String, trim: true, lowercase: true }],
    max_links_per_comment: { type: Number, default: 2, min: 0, max: 20 },
    auto_hide_flag_threshold: { type: Number, default: 3, min: 1, max: 50 },
    footer_text: { type: String, default: '' },
  },
  { timestamps }
);
settingSchema.plugin(toJSONPlugin);

const Setting = mongoose.model('Setting', settingSchema);

let cache = null;

Setting.get = async function get() {
  if (cache) return cache;
  let doc = await Setting.findOne({ key: 'global' }).lean();
  if (!doc) doc = (await Setting.create({ key: 'global' })).toObject();
  cache = doc;
  return doc;
};

Setting.invalidate = function invalidate() {
  cache = null;
};

module.exports = Setting;

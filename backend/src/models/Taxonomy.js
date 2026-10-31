const mongoose = require('mongoose');
const { timestamps, toJSONPlugin } = require('./plugins');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '', maxlength: 300 },
    color: { type: String, default: '#b4232a' },
  },
  { timestamps }
);
categorySchema.plugin(toJSONPlugin);

const tagSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    slug: { type: String, required: true, unique: true },
  },
  { timestamps }
);
tagSchema.plugin(toJSONPlugin);

module.exports = {
  Category: mongoose.model('Category', categorySchema),
  Tag: mongoose.model('Tag', tagSchema),
};

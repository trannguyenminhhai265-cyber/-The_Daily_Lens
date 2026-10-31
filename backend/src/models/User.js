const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, PERMISSIONS } = require('../config/roles');
const { timestamps, toJSONPlugin } = require('./plugins');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9_]{3,30}$/, 'Username must be 3-30 characters: letters, numbers or underscore'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    password_hash: { type: String, required: true, select: false },
    display_name: { type: String, required: true, trim: true, maxlength: 60 },
    bio: { type: String, default: '', maxlength: 500 },
    avatar_url: { type: String, default: '' },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER, index: true },
    // Extra permissions granted individually by a Super Admin (on top of the role defaults).
    permissions: [{ type: String, enum: Object.values(PERMISSIONS) }],
    status: { type: String, enum: ['active', 'banned'], default: 'active' },
    is_muted: { type: Boolean, default: false },
    last_login_at: Date,
  },
  { timestamps }
);

userSchema.methods.setPassword = async function setPassword(password) {
  this.password_hash = await bcrypt.hash(password, 10);
};

userSchema.methods.checkPassword = function checkPassword(password) {
  return bcrypt.compare(password, this.password_hash);
};

userSchema.plugin(toJSONPlugin);

module.exports = mongoose.model('User', userSchema);

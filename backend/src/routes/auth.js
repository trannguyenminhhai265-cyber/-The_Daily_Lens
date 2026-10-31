const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { signToken, authenticate, serializeUser } = require('../middleware/auth');
const { badRequest, HttpError } = require('../utils/http');
const { audit } = require('../utils/audit');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in a few minutes' },
});

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw badRequest('Password must be at least 8 characters long');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw badRequest('Password must contain at least one letter and one number');
  }
}

router.post('/register', authLimiter, async (req, res) => {
  const settings = await Setting.get();
  if (!settings.allow_registration) throw new HttpError(403, 'Registration is currently disabled');

  const { username, email, password, display_name } = req.body || {};
  if (!username || !email || !password) throw badRequest('Username, email and password are required');
  validatePassword(password);

  const user = new User({
    username,
    email,
    display_name: (display_name || username).trim(),
  });
  await user.setPassword(password);
  await user.save();
  await audit(req, 'user.register', { target_type: 'user', target_id: user._id, actor: user });

  res.status(201).json({ token: signToken(user), user: serializeUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) throw badRequest('Email/username and password are required');

  const identifier = String(login).toLowerCase().trim();
  const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+password_hash');
  if (!user || !(await user.checkPassword(password))) {
    await audit(req, 'auth.login_failed', { level: 'warn', details: { login: identifier } });
    throw new HttpError(401, 'Invalid credentials');
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended');

  user.last_login_at = new Date();
  await user.save();
  await audit(req, 'auth.login', { target_type: 'user', target_id: user._id, actor: user });

  res.json({ token: signToken(user), user: serializeUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

router.put('/me', authenticate, async (req, res) => {
  const { display_name, bio, avatar_url, email } = req.body || {};
  if (display_name !== undefined) req.user.display_name = display_name;
  if (bio !== undefined) req.user.bio = bio;
  if (avatar_url !== undefined) {
    if (avatar_url && !/^https?:\/\//i.test(avatar_url)) throw badRequest('Avatar URL must start with http(s)://');
    req.user.avatar_url = avatar_url;
  }
  if (email !== undefined) req.user.email = email;
  await req.user.save();
  res.json({ user: serializeUser(req.user) });
});

router.put('/me/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = await User.findById(req.user._id).select('+password_hash');
  if (!(await user.checkPassword(current_password || ''))) throw badRequest('Current password is incorrect');
  validatePassword(new_password);
  await user.setPassword(new_password);
  await user.save();
  await audit(req, 'auth.password_changed', { target_type: 'user', target_id: user._id });
  res.json({ ok: true });
});

module.exports = router;
module.exports.validatePassword = validatePassword;

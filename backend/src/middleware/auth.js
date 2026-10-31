const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { permissionsFor } = require('../config/roles');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

async function userFromRequest(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch {
    return null;
  }
}

/** Attaches req.user when a valid token is present, but never rejects the request. */
async function optionalAuth(req, _res, next) {
  req.user = await userFromRequest(req);
  next();
}

/** Rejects the request with 401 unless a valid token is present. */
async function authenticate(req, res, next) {
  req.user = await userFromRequest(req);
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

/** Allows the request when the user holds at least one of the given permissions. */
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const granted = permissionsFor(req.user);
    if (!permissions.some((p) => granted.has(p))) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

function hasPermission(user, permission) {
  return permissionsFor(user).has(permission);
}

function serializeUser(user) {
  return { ...user.toJSON(), effective_permissions: [...permissionsFor(user)] };
}

module.exports = { signToken, optionalAuth, authenticate, requirePermission, hasPermission, serializeUser };

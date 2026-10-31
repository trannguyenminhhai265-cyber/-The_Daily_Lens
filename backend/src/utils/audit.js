const { SystemLog } = require('../models/Logs');
const { clientIp } = require('./http');

/**
 * Writes an entry to the system log. Never throws: logging must not break a request.
 */
async function audit(req, action, { target_type = '', target_id = '', details = {}, level = 'info', actor } = {}) {
  try {
    const user = actor || (req && req.user);
    await SystemLog.create({
      level,
      action,
      actor_id: user ? user._id : null,
      actor_name: user ? user.username : 'anonymous',
      target_type,
      target_id: target_id ? String(target_id) : '',
      details,
      ip: req ? clientIp(req) : '',
    });
  } catch (err) {
    console.error('[audit] failed to write log:', err.message);
  }
}

module.exports = { audit };

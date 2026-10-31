const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg);

function paginate(query, defaultLimit = 10, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(total, page, limit) {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

function isObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

module.exports = { HttpError, badRequest, notFound, forbidden, paginate, pageMeta, isObjectId, clientIp };

const crypto = require('crypto');
const { error } = require('../utils/response');

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Cloud Scheduler / internal job tetikleyicileri — JOBS_SECRET zorunlu (production).
 */
function requireJobsSecret(req, res, next) {
  const secret = process.env.JOBS_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return error(res, 503, 'Jobs endpoint is not configured.');
    }
    return error(res, 401, 'JOBS_SECRET not set.');
  }

  const header = req.headers['x-jobs-secret'];
  const queryToken = req.query?.token;
  const provided = typeof header === 'string' ? header : typeof queryToken === 'string' ? queryToken : '';

  if (!provided || !timingSafeEqualString(provided, secret)) {
    return error(res, 401, 'Not authorized.');
  }

  next();
}

module.exports = { requireJobsSecret, timingSafeEqualString };

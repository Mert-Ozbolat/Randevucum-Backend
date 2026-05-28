const { error } = require('../utils/response');
const { timingSafeEqualString } = require('./jobsAuth');

function requireUltraMsgWebhookSecret(req, res, next) {
  const secret = String(process.env.ULTRAMSG_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return error(res, 503, 'UltraMsg webhook is not configured.');
    }
    return error(res, 401, 'ULTRAMSG_WEBHOOK_SECRET not set.');
  }

  const header = req.headers['x-ultramsg-secret'];
  const queryToken = req.query?.token;
  const provided = typeof header === 'string' ? header : typeof queryToken === 'string' ? queryToken : '';

  if (!provided || !timingSafeEqualString(provided, secret)) {
    return error(res, 401, 'Not authorized.');
  }

  return next();
}

module.exports = { requireUltraMsgWebhookSecret };


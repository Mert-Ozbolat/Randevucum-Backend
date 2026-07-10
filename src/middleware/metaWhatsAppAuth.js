const crypto = require('crypto');
const { error } = require('../utils/response');
const { timingSafeEqualString } = require('./jobsAuth');

/**
 * Meta Cloud API webhook imza doğrulaması (x-hub-signature-256).
 * express.raw() ile gelen Buffer gövde gerekir.
 */
function verifyMetaWhatsAppSignature(req, res, next) {
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  const raw = req.body;

  if (!Buffer.isBuffer(raw)) {
    return error(res, 400, 'Expected raw request body.');
  }

  if (appSecret) {
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !signature.startsWith('sha256=')) {
      return error(res, 401, 'Missing or invalid signature.');
    }
    const expected =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
    if (!timingSafeEqualString(signature, expected)) {
      return error(res, 401, 'Invalid signature.');
    }
  } else if (process.env.NODE_ENV === 'production') {
    return error(res, 503, 'WHATSAPP_APP_SECRET is not configured.');
  }

  try {
    req.metaWebhookBody = JSON.parse(raw.toString('utf8'));
  } catch {
    return error(res, 400, 'Invalid JSON body.');
  }

  return next();
}

module.exports = { verifyMetaWhatsAppSignature };

const { asyncHandler } = require('../utils/errors');
const { success, error } = require('../utils/response');
const { processIncomingRsvp } = require('../services/whatsappRsvp');
const { waLog } = require('../utils/whatsappLog');

function extractMetaIncomingMessages(body) {
  const messages = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== 'object') continue;
      const list = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of list) {
        messages.push(msg);
      }
    }
  }

  return messages;
}

function extractRsvpPayloadFromMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  const type = String(msg.type || '').toLowerCase();

  if (type === 'interactive') {
    const interactive = msg.interactive || {};
    if (interactive.type === 'button_reply' && interactive.button_reply?.id) {
      return String(interactive.button_reply.id);
    }
    if (interactive.type === 'list_reply' && interactive.list_reply?.id) {
      return String(interactive.list_reply.id);
    }
  }

  if (type === 'button' && msg.button?.payload) {
    return String(msg.button.payload);
  }

  if (type === 'text' && msg.text?.body) {
    return String(msg.text.body);
  }

  return null;
}

/** Meta webhook doğrulama (GET) */
exports.metaVerify = (req, res) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = req.query['hub.challenge'];

  const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (!expected) {
    return error(res, 503, 'WHATSAPP_VERIFY_TOKEN is not configured.');
  }

  if (mode === 'subscribe' && token === expected && challenge != null) {
    waLog('🔗', 'Meta webhook doğrulandı');
    return res.status(200).send(String(challenge));
  }

  return error(res, 403, 'Verification failed.');
};

/** Meta webhook gelen mesajlar (POST) */
exports.metaIncoming = asyncHandler(async (req, res) => {
  const body = req.metaWebhookBody || req.body;

  if (body?.object && body.object !== 'whatsapp_business_account') {
    return success(res, 200, { ok: true, ignored: true, object: body.object }, 'OK');
  }

  const messages = extractMetaIncomingMessages(body);
  const results = [];

  for (const msg of messages) {
    const fromPhone = msg.from ? String(msg.from) : '';
    const payload = extractRsvpPayloadFromMessage(msg);
    if (!fromPhone || !payload) {
      results.push({ ignored: true, reason: 'not_actionable', type: msg.type });
      continue;
    }

    const result = await processIncomingRsvp({ fromPhone, payload });
    results.push(result);
  }

  // Meta always expects 200 quickly to avoid retries.
  return success(res, 200, { ok: true, processed: results.length, results }, 'OK');
});

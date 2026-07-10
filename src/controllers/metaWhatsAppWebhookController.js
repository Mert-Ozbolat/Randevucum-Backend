const { asyncHandler } = require('../utils/errors');
const { success, error } = require('../utils/response');
const { processIncomingRsvp } = require('../services/whatsappRsvp');
const { waLog } = require('../utils/whatsappLog');
const { timingSafeEqualString } = require('../middleware/jobsAuth');

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

function readMetaHubParam(req, dottedKey, underscoreKey, nestedKey) {
  const q = req.query || {};
  if (q[dottedKey] != null && q[dottedKey] !== '') return String(q[dottedKey]);
  if (q[underscoreKey] != null && q[underscoreKey] !== '') return String(q[underscoreKey]);
  if (q.hub && typeof q.hub === 'object' && q.hub[nestedKey] != null) {
    return String(q.hub[nestedKey]);
  }
  return '';
}

/** Meta webhook doğrulama (GET) */
exports.metaVerify = (req, res) => {
  const mode = readMetaHubParam(req, 'hub.mode', 'hub_mode', 'mode');
  const token = readMetaHubParam(req, 'hub.verify_token', 'hub_verify_token', 'verify_token').trim();
  const challengeRaw = readMetaHubParam(req, 'hub.challenge', 'hub_challenge', 'challenge');
  const challenge = challengeRaw || req.query['hub.challenge'] || req.query.hub_challenge;

  const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (!expected) {
    return error(res, 503, 'WHATSAPP_VERIFY_TOKEN is not configured.');
  }

  const modeOk = mode === 'subscribe';
  const tokenOk = token && timingSafeEqualString(token, expected);
  const challengeOk = challenge != null && String(challenge).length > 0;

  if (modeOk && tokenOk && challengeOk) {
    waLog('🔗', 'Meta webhook doğrulandı');
    return res.status(200).type('text/plain').send(String(challenge));
  }

  waLog('⚠️', 'Meta webhook doğrulama başarısız', {
    modeOk,
    tokenOk,
    challengeOk,
    mode: mode || '(empty)',
    tokenLength: token.length,
    expectedLength: expected.length,
    hint: !tokenOk
      ? 'WHATSAPP_VERIFY_TOKEN ile Meta panelindeki Verify token birebir aynı olmalı (EAA access token değil).'
      : undefined,
  });

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

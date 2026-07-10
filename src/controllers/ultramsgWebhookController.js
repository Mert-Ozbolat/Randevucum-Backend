const { asyncHandler } = require('../utils/errors');
const { success } = require('../utils/response');
const { normalizeE164Tr } = require('../services/whatsapp');
const { processIncomingRsvp } = require('../services/whatsappRsvp');

function extractUltraMsgIncoming(reqBody) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const eventType = body.event_type || body.eventType || body.type || '';
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const from = data.from || body.from || '';
  const text = data.body || body.body || data.text || '';
  return { eventType: String(eventType), from: String(from), text: String(text) };
}

function normalizeUltraMsgFrom(from) {
  const raw = String(from || '').trim();
  const withoutSuffix = raw.replace(/@c\.us$/i, '').trim();
  const digitsOrPlus = withoutSuffix.replace(/[^\d+]/g, '');
  return normalizeE164Tr(digitsOrPlus);
}

exports.ultramsgIncoming = asyncHandler(async (req, res) => {
  const { eventType, from, text } = extractUltraMsgIncoming(req.body);
  if (eventType && eventType !== 'message_received') {
    return success(res, 200, { ok: true, ignored: true, eventType }, 'OK');
  }

  const fromE164 = normalizeUltraMsgFrom(from);
  if (!fromE164 || !String(text || '').trim()) {
    return success(
      res,
      200,
      { ok: true, ignored: true, from: from ? '(present)' : '(missing)', hasText: Boolean(text) },
      'OK'
    );
  }

  const result = await processIncomingRsvp({ fromPhone: fromE164, payload: text });
  return success(res, 200, { ok: true, ...result }, 'OK');
});

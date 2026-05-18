const { normalizeE164Tr } = require('../utils/phone');

/**
 * WhatsApp delivery channel.
 * Default is Twilio (`twilio`). Set WHATSAPP_PROVIDER=meta for Meta Cloud API.
 */
function getProvider() {
  return String(process.env.WHATSAPP_PROVIDER || 'twilio').trim().toLowerCase(); // twilio | meta
}

function isTwilioConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  return Boolean(sid && token && from);
}

function isMetaConfigured() {
  return Boolean(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function isEnabled() {
  return String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';
}

async function sendViaMetaCloud({ toE164, body, tag }) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  if (!token || !phoneNumberId) {
    return { ok: false, skipped: true, reason: 'meta_not_configured' };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toE164.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: false, body },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Meta WhatsApp API error (HTTP ${res.status})`;
    console.error('[whatsapp][meta] send failed', { tag, status: res.status, message: msg });
    return { ok: false, reason: 'meta_send_failed', message: msg, status: res.status };
  }

  const messageId = json?.messages?.[0]?.id;
  return { ok: true, provider: 'meta', messageId };
}

async function sendViaTwilio({ toE164, body, tag }) {
  if (!isTwilioConfigured()) {
    return { ok: false, skipped: true, reason: 'twilio_not_configured' };
  }

  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const twilio = require('twilio');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = String(process.env.TWILIO_WHATSAPP_FROM || '').trim();

  const client = twilio(sid, token);
  const to = toE164.startsWith('+') ? `whatsapp:${toE164}` : `whatsapp:+${toE164.replace(/^\+/, '')}`;

  const fromBare = from.replace(/^whatsapp:/i, '').trim();
  const fromE164 = normalizeE164Tr(fromBare);
  if (fromE164 && fromE164 === toE164) {
    return {
      ok: false,
      skipped: true,
      reason: 'twilio_same_to_from',
      message:
        'Twilio: Gönderen (TWILIO_WHATSAPP_FROM) ile alıcı numara aynı olamaz. FROM alanı Twilio konsolundaki WhatsApp sandbox / onaylı gönderen olmalı (genelde +1...), alıcı ise müşteri veya işletme hattı (+90...) olmalı.',
    };
  }

  try {
    const msg = await client.messages.create({
      from,
      to,
      body,
    });
    return { ok: true, provider: 'twilio', sid: msg.sid };
  } catch (e) {
    const message = e?.message || String(e);
    const code = e?.code;
    console.error('[whatsapp][twilio] send failed', { tag, message, code });
    if (/could not find a channel with the specified from address/i.test(message)) {
      return {
        ok: false,
        reason: 'twilio_invalid_from',
        message:
          'Twilio: TWILIO_WHATSAPP_FROM bu hesapta WhatsApp gönderen olarak tanımlı değil. Twilio Console → Messaging → WhatsApp sandbox’taki tam "From" değerini kopyala (örn. whatsapp:+14155238886). Kendi +90 hattını FROM yapma.',
        code,
      };
    }
    return { ok: false, reason: 'twilio_send_failed', message, code };
  }
}

/**
 * Send a WhatsApp text message (reminders, etc.).
 * When WHATSAPP_ENABLED is not true, logs only (dry-run).
 */
async function sendWhatsApp({ toPhone, body, tag }) {
  const to = normalizeE164Tr(toPhone);
  if (!to) {
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }

  const enabled = isEnabled();
  let provider = getProvider();

  if (!enabled) {
    console.log('[whatsapp][dry-run]', {
      tag,
      to,
      provider,
      enabled,
      body,
    });
    return { ok: true, dryRun: true };
  }

  // If the chosen provider is not configured, try the other (Meta still supported).
  if (provider === 'twilio' && !isTwilioConfigured() && isMetaConfigured()) {
    console.warn('[whatsapp] WHATSAPP_PROVIDER=twilio but Twilio env missing; falling back to Meta.');
    provider = 'meta';
  }
  if (provider === 'meta' && !isMetaConfigured() && isTwilioConfigured()) {
    console.warn('[whatsapp] WHATSAPP_PROVIDER=meta but Meta env missing; falling back to Twilio.');
    provider = 'twilio';
  }

  if (provider === 'twilio') {
    return await sendViaTwilio({ toE164: to, body, tag });
  }
  return await sendViaMetaCloud({ toE164: to, body, tag });
}

module.exports = { sendWhatsApp, normalizeE164Tr, isEnabled, isTwilioConfigured, isMetaConfigured };

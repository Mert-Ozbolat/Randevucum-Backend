function normalizeE164Tr(phoneRaw) {
  const raw = String(phoneRaw || '').trim();
  if (!raw) return null;
  // Very small normalizer for Turkey numbers:
  // - accepts +90..., 90..., 0..., or 5xxxxxxxxx
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const only = digits.replace(/[^\d]/g, '');
  if (only.startsWith('90') && only.length >= 12) return `+${only}`;
  if (only.startsWith('0') && only.length >= 11) return `+9${only}`; // 0XXXXXXXXXX -> +90XXXXXXXXXX
  if (only.length === 10 && only.startsWith('5')) return `+90${only}`; // 5XXXXXXXXX -> +905XXXXXXXXX
  if (only.length === 11 && only.startsWith('5')) return `+90${only}`; // 5XXXXXXXXXX (rare)
  return only.length >= 10 ? `+${only}` : null;
}

function getProvider() {
  return String(process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase(); // meta | twilio
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
  // Optional fallback; requires twilio package and envs.
  // Lazy require so projects can run without Twilio configured.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const twilio = require('twilio');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  if (!sid || !token || !from) return { ok: false, skipped: true, reason: 'twilio_not_configured' };
  const client = twilio(sid, token);
  const msg = await client.messages.create({
    from,
    to: `whatsapp:${toE164}`,
    body,
  });
  return { ok: true, provider: 'twilio', sid: msg.sid };
}

async function sendWhatsApp({ toPhone, body, tag }) {
  const to = normalizeE164Tr(toPhone);
  if (!to) {
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }

  const enabled = isEnabled();
  const provider = getProvider();

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

  if (provider === 'twilio') {
    return await sendViaTwilio({ toE164: to, body, tag });
  }
  return await sendViaMetaCloud({ toE164: to, body, tag });
}

module.exports = { sendWhatsApp, normalizeE164Tr };


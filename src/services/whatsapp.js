const { normalizeE164Tr } = require('../utils/phone');
const { waLog } = require('../utils/whatsappLog');

/**
 * WhatsApp delivery channel.
 * Default is Meta Cloud API (`meta`). Alternatives: `ultramsg`.
 */
function getProvider() {
  return String(process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
}

function isUltraMsgConfigured() {
  const instanceId = String(process.env.ULTRAMSG_INSTANCE_ID || '').trim();
  const token = String(process.env.ULTRAMSG_TOKEN || '').trim();
  return Boolean(instanceId && token);
}

function isMetaConfigured() {
  return Boolean(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function isEnabled() {
  return String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';
}

function ultramsgDeliveryHint(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  if (msg.includes('wrong token')) {
    return 'ULTRAMSG_TOKEN yanlış veya eksik. UltraMsg panel → Instance → API token.';
  }
  if (msg.includes('not authorized') || msg.includes('instance not')) {
    return 'WhatsApp instance bağlı değil. UltraMsg panelden QR ile oturum açın; mesaj kuyruğa alınabilir.';
  }
  if (errorMessage) return String(errorMessage);
  return 'UltraMsg panel → Messages / Logs bölümünden mesaj durumunu kontrol edin.';
}

function parseUltraMsgResponse(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, message: 'Invalid UltraMsg response' };
  }
  if (json.error) {
    return { ok: false, message: String(json.error) };
  }
  const sent = json.sent;
  const accepted =
    sent === true ||
    sent === 'true' ||
    sent === 1 ||
    sent === '1' ||
    String(json.message || '').toLowerCase() === 'ok';
  if (accepted) {
    return { ok: true, messageId: json.id ?? json.messageId ?? null, queued: sent === 'queue' || json.queued === true };
  }
  const message = json.message || json.description || 'UltraMsg rejected the message';
  return { ok: false, message: String(message) };
}

async function sendViaUltraMsg({ toE164, body, tag }) {
  if (!isUltraMsgConfigured()) {
    return { ok: false, skipped: true, reason: 'ultramsg_not_configured' };
  }

  const instanceId = String(process.env.ULTRAMSG_INSTANCE_ID || '').trim();
  const token = String(process.env.ULTRAMSG_TOKEN || '').trim();
  const priority = Number(process.env.ULTRAMSG_PRIORITY ?? 5);
  const referenceId = String(process.env.ULTRAMSG_REFERENCE_PREFIX || 'randevucum')
    .trim()
    .concat('-', tag || 'msg', '-', Date.now());

  const url = `https://api.ultramsg.com/${encodeURIComponent(instanceId)}/messages/chat`;
  const form = new URLSearchParams({
    token,
    to: toE164,
    body,
    priority: String(Number.isFinite(priority) ? priority : 5),
    referenceId,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const raw = await res.text();
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { error: raw || `HTTP ${res.status}` };
    }

    if (!res.ok) {
      const message =
        json?.error ||
        json?.message ||
        (typeof raw === 'string' && raw.trim() ? raw.trim() : `UltraMsg HTTP ${res.status}`);
      console.error('[whatsapp][ultramsg] send failed', { tag, status: res.status, message });
      return {
        ok: false,
        reason: 'ultramsg_send_failed',
        message: String(message),
        status: res.status,
        hint: ultramsgDeliveryHint(message),
      };
    }

    const parsed = parseUltraMsgResponse(json);
    if (!parsed.ok) {
      console.error('[whatsapp][ultramsg] rejected', { tag, json });
      return {
        ok: false,
        reason: 'ultramsg_rejected',
        message: parsed.message,
        hint: ultramsgDeliveryHint(parsed.message),
      };
    }

    return {
      ok: true,
      provider: 'ultramsg',
      messageId: parsed.messageId,
      queued: parsed.queued,
    };
  } catch (e) {
    const message = e?.message || String(e);
    console.error('[whatsapp][ultramsg] request error', { tag, message });
    return { ok: false, reason: 'ultramsg_request_failed', message };
  }
}

async function sendViaMetaCloud({ toE164, body, tag, interactive, template }) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  if (!token || !phoneNumberId) {
    return { ok: false, skipped: true, reason: 'meta_not_configured' };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const to = toE164.replace(/^\+/, '');

  let payload;
  if (template) {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    };
  } else if (interactive) {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body },
    };
  }

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

function resolveActiveProvider(requested) {
  const order = ['meta', 'ultramsg'];
  const configured = {
    meta: isMetaConfigured(),
    ultramsg: isUltraMsgConfigured(),
  };

  if (configured[requested]) return requested;

  const fallback = order.find((p) => configured[p]);
  if (fallback) {
    console.warn(`[whatsapp] WHATSAPP_PROVIDER=${requested} not configured; falling back to ${fallback}.`);
    return fallback;
  }
  return requested;
}

/**
 * Meta interactive Evet/Hayır butonlu mesaj.
 * buttons: [{ id, title }] — title max 20 karakter
 */
async function sendWhatsAppInteractive({ toPhone, body, buttons, tag }) {
  const to = normalizeE164Tr(toPhone);
  if (!to) {
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }
  if (!isEnabled()) {
    waLog('📴', 'DRY-RUN interactive', { tag, to, buttons: buttons?.length });
    return { ok: true, dryRun: true, reason: 'whatsapp_disabled' };
  }

  const provider = resolveActiveProvider(getProvider());
  if (provider !== 'meta') {
    return { ok: false, reason: 'interactive_requires_meta' };
  }

  const interactive = {
    type: 'button',
    body: { text: String(body || '').slice(0, 1024) },
    action: {
      buttons: (buttons || []).slice(0, 3).map((b) => ({
        type: 'reply',
        reply: {
          id: String(b.id).slice(0, 256),
          title: String(b.title).slice(0, 20),
        },
      })),
    },
  };

  waLog('📤', 'Meta interactive gönderim', { tag, to });
  const res = await sendViaMetaCloud({ toE164: to, tag, interactive });
  if (res.ok) waLog('✅', 'Meta interactive gönderildi', { tag, messageId: res.messageId });
  else waLog('❌', 'Meta interactive hata', { tag, message: res.message });
  return res;
}

/**
 * Onaylı Meta şablonu ile RSVP hatırlatması (24 saat kuralı dışı mesajlar için).
 * WHATSAPP_TEMPLATE_RSVP_NAME ve body parametreleri gerekir.
 */
async function sendWhatsAppRsvpTemplate({
  toPhone,
  templateName,
  languageCode,
  bodyParams,
  buttonPayloads,
  tag,
}) {
  const to = normalizeE164Tr(toPhone);
  if (!to) return { ok: false, skipped: true, reason: 'invalid_phone' };
  if (!isEnabled()) return { ok: true, dryRun: true, reason: 'whatsapp_disabled' };

  const name = templateName || process.env.WHATSAPP_TEMPLATE_RSVP_NAME;
  const lang = languageCode || process.env.WHATSAPP_TEMPLATE_RSVP_LANG || 'tr';
  if (!name) return { ok: false, reason: 'template_not_configured' };

  const components = [];
  if (bodyParams?.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
    });
  }
  (buttonPayloads || []).forEach((payload, index) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload: String(payload).slice(0, 256) }],
    });
  });

  const template = {
    name,
    language: { code: lang },
    ...(components.length ? { components } : {}),
  };

  waLog('📤', 'Meta template RSVP gönderim', { tag, to, template: name });
  return sendViaMetaCloud({ toE164: to, tag, template });
}

/**
 * RSVP hatırlatması: Meta'da önce template, yoksa interactive; UltraMsg'de metin (ONAY/IPTAL).
 */
async function sendWhatsAppRsvpPrompt({
  toPhone,
  body,
  textFallbackBody,
  yesButtonId,
  noButtonId,
  templateBodyParams,
  tag,
}) {
  const provider = resolveActiveProvider(getProvider());
  const templateName = process.env.WHATSAPP_TEMPLATE_RSVP_NAME;
  const textBody = textFallbackBody || body;

  if (provider === 'meta' && templateName) {
    const res = await sendWhatsAppRsvpTemplate({
      toPhone,
      bodyParams: templateBodyParams,
      buttonPayloads: [yesButtonId, noButtonId],
      tag,
    });
    if (res.ok || res.dryRun) return res;
    waLog('⚠️', 'Template gönderilemedi, interactive deneniyor', { message: res.message });
  }

  if (provider === 'meta') {
    const res = await sendWhatsAppInteractive({
      toPhone,
      body,
      buttons: [
        { id: yesButtonId, title: 'Evet, geleceğim' },
        { id: noButtonId, title: 'Hayır, iptal et' },
      ],
      tag,
    });
    if (res.ok || res.dryRun) return res;
    waLog('⚠️', 'Interactive gönderilemedi, düz metne düşülüyor', { message: res.message });
  }

  return sendWhatsApp({ toPhone, body: textBody, tag });
}

/**
 * Send a WhatsApp text message (reminders, booking notifications, etc.).
 * When WHATSAPP_ENABLED is not true, logs only (dry-run).
 */
async function sendWhatsApp({ toPhone, body, tag }) {
  const to = normalizeE164Tr(toPhone);
  if (!to) {
    waLog('📵', 'Geçersiz veya boş telefon — mesaj atlanmadı', { tag, raw: toPhone ? '(var ama normalize edilemedi)' : '(yok)' });
    return { ok: false, skipped: true, reason: 'invalid_phone' };
  }

  const enabled = isEnabled();
  let provider = resolveActiveProvider(getProvider());

  if (!enabled) {
    waLog('📴', 'DRY-RUN — WHATSAPP_ENABLED≠true, API çağrılmadı', {
      tag,
      to,
      provider,
      hint: 'Production .env içinde WHATSAPP_ENABLED=true yapın',
    });
    return { ok: true, dryRun: true, reason: 'whatsapp_disabled' };
  }

  if (provider === 'meta' && !isMetaConfigured() && isUltraMsgConfigured()) {
    provider = 'ultramsg';
  } else if (provider === 'ultramsg' && !isUltraMsgConfigured() && isMetaConfigured()) {
    provider = 'meta';
  }

  if (!isMetaConfigured() && !isUltraMsgConfigured()) {
    waLog('❌', 'WhatsApp yapılandırılmamış', {
      tag,
      hint: 'WHATSAPP_CLOUD_TOKEN + WHATSAPP_PHONE_NUMBER_ID veya UltraMsg ayarlayın',
    });
    return { ok: false, skipped: true, reason: 'whatsapp_not_configured' };
  }

  waLog('📤', `Gönderim denemesi (${provider})`, { tag, to });

  if (provider === 'ultramsg') {
    const res = await sendViaUltraMsg({ toE164: to, body, tag });
    if (res.ok) {
      waLog(res.queued ? '⏳' : '✅', res.queued ? 'UltraMsg kuyruğa aldı (instance hazır olunca gider)' : 'UltraMsg mesaj gönderildi', {
        tag,
        to,
        messageId: res.messageId,
        queued: Boolean(res.queued),
      });
    } else if (!res.skipped) {
      waLog('❌', 'UltraMsg gönderim hatası', {
        tag,
        reason: res.reason,
        message: res.message,
        hint: res.hint || ultramsgDeliveryHint(res.message),
      });
    }
    return res;
  }

  if (provider === 'meta') {
    const res = await sendViaMetaCloud({ toE164: to, body, tag });
    if (res.ok) waLog('✅', 'Meta mesaj gönderildi', { tag, messageId: res.messageId });
    else if (!res.skipped) waLog('❌', 'Meta gönderim hatası', { tag, reason: res.reason, message: res.message });
    return res;
  }

  waLog('❌', 'Bilinmeyen WHATSAPP_PROVIDER', {
    tag,
    provider,
    hint: 'meta veya ultramsg kullanın (WHATSAPP_PROVIDER=meta)',
  });
  return { ok: false, reason: 'unknown_provider', provider };
}

module.exports = {
  sendWhatsApp,
  sendWhatsAppInteractive,
  sendWhatsAppRsvpTemplate,
  sendWhatsAppRsvpPrompt,
  normalizeE164Tr,
  isEnabled,
  isUltraMsgConfigured,
  isMetaConfigured,
  getProvider,
};

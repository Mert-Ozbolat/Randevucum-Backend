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
  let messageType = 'session_text';
  if (template) {
    messageType = 'template';
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    };
  } else if (interactive) {
    messageType = 'interactive';
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
    };
  } else {
    const textBody = formatBodyForMeta(body);
    if (!textBody.trim()) {
      return { ok: false, reason: 'meta_empty_body', message: 'Message body is empty after formatting.' };
    }
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: textBody },
    };
  }

  waLog('📡', 'Meta API isteği', {
    tag,
    to: `+${to}`,
    messageType,
    templateName: template?.name || null,
    bodyPreview:
      messageType === 'session_text'
        ? String(formatBodyForMeta(body)).slice(0, 120)
        : undefined,
  });

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
    const err = json?.error || {};
    const msg =
      err.message ||
      json?.message ||
      `Meta WhatsApp API error (HTTP ${res.status})`;
    const hint = metaErrorHint(err, to);
    console.error('[whatsapp][meta] send failed', {
      tag,
      status: res.status,
      message: msg,
      code: err.code,
      error_subcode: err.error_subcode,
      error_data: err.error_data,
      fbtrace_id: err.fbtrace_id,
      to,
      hint,
    });
    return {
      ok: false,
      reason: 'meta_send_failed',
      message: msg,
      status: res.status,
      code: err.code,
      errorSubcode: err.error_subcode,
      hint,
    };
  }

  const firstMessage = json?.messages?.[0] || {};
  const messageId = firstMessage.id || null;
  const messageStatus = firstMessage.message_status
    ? String(firstMessage.message_status).toLowerCase()
    : null;
  const contactWaId = json?.contacts?.[0]?.wa_id;
  return {
    ok: true,
    provider: 'meta',
    messageId,
    messageStatus,
    messageType,
    to: `+${to}`,
    contactWaId: contactWaId || null,
  };
}

function metaDeliveryHint(messageType, messageStatus) {
  if (messageStatus && messageStatus !== 'accepted') {
    return `Meta mesaj durumu: ${messageStatus}. WhatsApp Manager → Message logs kontrol edin.`;
  }
  return messageType === 'template'
    ? 'Meta kuyruğa aldı. Teslimat webhook ile loglanır (📨 sent → 📬 delivered veya 🚫 failed). Mesajlar bağlı WhatsApp Business hattınızdan gelir.'
    : 'Session (serbest metin): alıcı son 24 saatte size yazmadıysa Meta teslim ETMEZ. Onaylı şablon kullanın.';
}

async function sendViaMetaCloudResolved({ toE164, body, tag, interactive, template }) {
  const recipient = await resolveMetaRecipientE164(toE164);
  if (recipient.skipped) {
    waLog('⏭️', 'Meta: WhatsApp Business hattına mesaj gönderilemez', {
      tag,
      to: toE164,
      wabaPhone: recipient.wabaPhone,
      hint: recipient.hint,
    });
    return {
      ok: false,
      skipped: true,
      reason: recipient.reason,
      hint: recipient.hint,
      wabaPhone: recipient.wabaPhone,
    };
  }
  if (recipient.redirectedFrom) {
    waLog('↪️', 'Bildirim alternatif numaraya yönlendirildi (WA hattı = alıcı)', {
      tag,
      from: recipient.redirectedFrom,
      to: recipient.to,
      wabaPhone: recipient.wabaPhone,
    });
  }

  const res = await sendViaMetaCloud({
    toE164: recipient.to,
    body,
    tag,
    interactive,
    template,
  });

  if (res.ok) {
    waLog('✅', 'Meta mesaj kabul edildi (API — teslimat webhook ile doğrulanır)', {
      tag,
      messageId: res.messageId,
      messageStatus: res.messageStatus || 'accepted',
      messageType: res.messageType,
      to: res.to || recipient.to,
      contactWaId: res.contactWaId,
      hint: metaDeliveryHint(res.messageType, res.messageStatus),
    });
  } else if (!res.skipped) {
    waLog('❌', 'Meta gönderim hatası', {
      tag,
      to: recipient.to,
      reason: res.reason,
      message: res.message,
      code: res.code,
      errorSubcode: res.errorSubcode,
      hint: res.hint,
    });
  }

  return res;
}

/** Meta düz metin: WhatsApp markdown sadeleştir, max 4096 karakter */
function formatBodyForMeta(body) {
  return String(body || '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/·/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 4096);
}

function metaErrorHint(err, to) {
  const code = Number(err?.code);
  const subcode = Number(err?.error_subcode);
  if (code === 131030 || subcode === 131030) {
    return `Alıcı (${to}) Meta test listesinde değil. Developer Console → WhatsApp → API Setup → "To" alanına numarayı ekleyin veya uygulamayı Live moda alın.`;
  }
  if (code === 131047 || subcode === 131047) {
    return '24 saat kuralı: serbest metin gönderilemez. Onaylı WhatsApp şablonu (template) gerekir.';
  }
  if (code === 133010 || subcode === 133010) {
    return `Alıcı numarası (${to}) WhatsApp'ta kayıtlı değil veya geçersiz.`;
  }
  if (code === 100) {
    return `Alıcı (${to}) büyük ihtimalle Meta WhatsApp Business hattınızla aynı numara — API kendi numarasına mesaj gönderemez. İşletme profilinde farklı bir bildirim telefonu kullanın veya WHATSAPP_BUSINESS_NOTIFICATION_PHONE ayarlayın.`;
  }
  if (code === 132001) {
    return 'Şablon bu dilde gönderilemiyor: ya AD/dil eşleşmiyor ya da henüz APPROVED değil (PENDING iken Meta 132001 döner). WhatsApp Manager → Message templates.';
  }
  if (code === 132018) {
    const details = String(err?.error_data?.details || err?.message || '').toLowerCase();
    if (details.includes('header')) {
      return 'Şablonunuzda Location header yok ama API header gönderiyor. WHATSAPP_TEMPLATE_BOOKING_USE_LOCATION_HEADER=false bırakın veya şablona Location header ekleyip true yapın.';
    }
    return 'Şablon parametreleri Meta şablonuyla uyuşmuyor (header, body veya buton). Paneldeki değişken/buton yapısı ile kod aynı olmalı.';
  }
  return err?.error_user_msg || null;
}

let metaWabaPhoneCache = { value: null, expires: 0 };

function phoneDigitsLast10(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function phonesMatch(a, b) {
  const da = phoneDigitsLast10(a);
  const db = phoneDigitsLast10(b);
  return Boolean(da && db && da.length >= 10 && da === db);
}

/** Meta'ya bağlı WhatsApp Business hattının telefon numarası */
async function resolveMetaWabaPhoneE164() {
  const fromEnv =
    process.env.WHATSAPP_BUSINESS_PHONE_E164 || process.env.WHATSAPP_BUSINESS_PHONE;
  if (fromEnv) return normalizeE164Tr(fromEnv);

  if (metaWabaPhoneCache.expires > Date.now()) return metaWabaPhoneCache.value;

  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  if (!token || !phoneNumberId) return null;

  try {
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}?fields=display_phone_number`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    const normalized = json?.display_phone_number
      ? normalizeE164Tr(json.display_phone_number)
      : null;
    metaWabaPhoneCache = { value: normalized, expires: Date.now() + 60 * 60 * 1000 };
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Meta'da alıcı = kendi WA Business hattınızsa gönderim yapılamaz (#100).
 * WHATSAPP_BUSINESS_NOTIFICATION_PHONE varsa alternatif numaraya yönlendir.
 */
async function resolveMetaRecipientE164(toE164) {
  const wabaPhone = await resolveMetaWabaPhoneE164();
  if (!wabaPhone || !phonesMatch(toE164, wabaPhone)) {
    return { to: toE164, skipped: false };
  }

  const alt = normalizeE164Tr(process.env.WHATSAPP_BUSINESS_NOTIFICATION_PHONE);
  if (alt && !phonesMatch(alt, wabaPhone)) {
    return {
      to: alt,
      skipped: false,
      redirectedFrom: toE164,
      wabaPhone,
    };
  }

  return {
    to: toE164,
    skipped: true,
    reason: 'recipient_is_waba_phone',
    wabaPhone,
    hint:
      'İşletme telefonu Meta WhatsApp hattınızla aynı. Bildirimler için işletme profilinde farklı bir telefon girin veya Cloud Run\'da WHATSAPP_BUSINESS_NOTIFICATION_PHONE tanımlayın.',
  };
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
  return sendViaMetaCloudResolved({ toE164: to, tag, interactive });
}

/**
 * Meta Cloud API ile onaylı şablon mesajı.
 */
async function sendWhatsAppTemplate({
  toPhone,
  templateName,
  languageCode,
  bodyParams,
  bodyParamNames,
  headerLocation,
  urlButtons,
  tag,
}) {
  const to = normalizeE164Tr(toPhone);
  if (!to) return { ok: false, skipped: true, reason: 'invalid_phone' };
  if (!isEnabled()) return { ok: true, dryRun: true, reason: 'whatsapp_disabled' };
  if (!templateName) return { ok: false, reason: 'template_not_configured' };

  const lang = languageCode || process.env.WHATSAPP_TEMPLATE_LANG || 'tr';
  const components = [];

  if (headerLocation?.latitude != null && headerLocation?.longitude != null) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'location',
          location: {
            latitude: String(headerLocation.latitude),
            longitude: String(headerLocation.longitude),
            name: String(headerLocation.name || 'Isletme').slice(0, 256),
            address: String(headerLocation.address || '').slice(0, 256),
          },
        },
      ],
    });
  }

  if (bodyParams?.length) {
    const names = Array.isArray(bodyParamNames) ? bodyParamNames : [];
    components.push({
      type: 'body',
      parameters: bodyParams.map((text, index) => {
        const param = { type: 'text', text: String(text).slice(0, 1024) };
        if (names[index]) param.parameter_name = String(names[index]);
        return param;
      }),
    });
  }
  (urlButtons || []).forEach((btn) => {
    const param = { type: 'text', text: String(btn.text ?? '').slice(0, 2000) };
    if (btn.parameterName) param.parameter_name = String(btn.parameterName);
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(btn.index ?? 0),
      parameters: [param],
    });
  });

  const template = {
    name: templateName,
    language: { code: lang },
    ...(components.length ? { components } : {}),
  };

  waLog('📤', 'Meta template gönderim', {
    tag,
    to,
    template: templateName,
    urlButtons: urlButtons?.length || 0,
    hasLocationHeader: Boolean(headerLocation),
  });
  return sendViaMetaCloudResolved({ toE164: to, tag, template });
}

/**
 * Onaylı Meta şablonu ile RSVP hatırlatması (24 saat kuralı dışı mesajlar için).
 */
async function sendWhatsAppRsvpTemplate({
  toPhone,
  templateName,
  languageCode,
  bodyParams,
  bodyParamNames,
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
    const names = Array.isArray(bodyParamNames) ? bodyParamNames : [];
    components.push({
      type: 'body',
      parameters: bodyParams.map((text, index) => {
        const param = { type: 'text', text: String(text).slice(0, 1024) };
        if (names[index]) param.parameter_name = String(names[index]);
        return param;
      }),
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
  templateName,
  templateBodyParams,
  templateBodyParamNames,
  tag,
}) {
  const provider = resolveActiveProvider(getProvider());
  const resolvedTemplateName = templateName || process.env.WHATSAPP_TEMPLATE_RSVP_NAME;
  const textBody = textFallbackBody || body;

  if (provider === 'meta' && resolvedTemplateName) {
    const res = await sendWhatsAppRsvpTemplate({
      toPhone,
      templateName: resolvedTemplateName,
      bodyParams: templateBodyParams,
      bodyParamNames: templateBodyParamNames,
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
    return sendViaMetaCloudResolved({ toE164: to, body, tag });
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
  sendWhatsAppTemplate,
  sendWhatsAppRsvpTemplate,
  sendWhatsAppRsvpPrompt,
  normalizeE164Tr,
  phonesMatch,
  resolveMetaWabaPhoneE164,
  isEnabled,
  isUltraMsgConfigured,
  isMetaConfigured,
  getProvider,
};

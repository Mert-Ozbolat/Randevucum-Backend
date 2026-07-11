const { waLog } = require('../utils/whatsappLog');

function extractMetaWebhookStatuses(body) {
  const statuses = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value || typeof value !== 'object') continue;
      const list = Array.isArray(value.statuses) ? value.statuses : [];
      for (const status of list) {
        statuses.push(status);
      }
    }
  }

  return statuses;
}

function metaStatusErrorHint(errors) {
  const list = Array.isArray(errors) ? errors : [];
  const first = list[0] || {};
  const code = Number(first.code);
  const subcode = Number(first.error_subcode);
  const title = first.title || first.message || '';

  if (code === 131047 || subcode === 131047 || /re-engagement|24 hour/i.test(title)) {
    return '24 saat kuralı: alıcı son 24 saatte size yazmadı. Onaylı WhatsApp şablonu (template) gerekir — serbest metin teslim edilmez.';
  }
  if (code === 131026 || subcode === 131026) {
    return 'Mesaj iletilemedi — numara WhatsApp kullanmıyor olabilir veya geçersiz.';
  }
  if (code === 131030 || subcode === 131030) {
    return 'Alıcı test listesinde değil (Development mod) veya numara engelli.';
  }
  if (code === 130472 || subcode === 130472) {
    return 'Meta deney/kısıtlama — numara geçici olarak mesaj alamıyor olabilir.';
  }
  if (code === 131049 || subcode === 131049) {
    return 'Meta ekosistem kuralı — çok fazla pazarlama mesajı veya kalite puanı düşük olabilir.';
  }
  if (title) return String(title);
  return 'Meta teslimat hatası — WhatsApp Manager → Message logs bölümünü kontrol edin.';
}

function logMetaDeliveryStatus(status) {
  if (!status || typeof status !== 'object') return;

  const id = status.id ? String(status.id) : '';
  const state = String(status.status || '').toLowerCase();
  const recipient = status.recipient_id ? String(status.recipient_id) : '';
  const errors = status.errors;

  if (state === 'sent') {
    waLog('📨', 'Meta teslimat: gönderildi (sent)', { messageId: id, recipient });
    return;
  }
  if (state === 'delivered') {
    waLog('📬', 'Meta teslimat: iletildi (delivered)', { messageId: id, recipient });
    return;
  }
  if (state === 'read') {
    waLog('👁️', 'Meta teslimat: okundu (read)', { messageId: id, recipient });
    return;
  }
  if (state === 'failed') {
    waLog('🚫', 'Meta teslimat BAŞARISIZ (failed)', {
      messageId: id,
      recipient,
      errors,
      hint: metaStatusErrorHint(errors),
    });
    return;
  }

  waLog('ℹ️', 'Meta teslimat durumu', { messageId: id, status: state || '(unknown)', recipient });
}

function processMetaDeliveryWebhook(body) {
  const statuses = extractMetaWebhookStatuses(body);
  for (const status of statuses) {
    logMetaDeliveryStatus(status);
  }
  return statuses.length;
}

module.exports = {
  extractMetaWebhookStatuses,
  metaStatusErrorHint,
  logMetaDeliveryStatus,
  processMetaDeliveryWebhook,
};

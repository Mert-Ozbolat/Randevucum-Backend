/**
 * Türkiye telefon numarasını WhatsApp (UltraMsg / Meta) uyumlu E.164 formatına çevirir: +905XXXXXXXXX
 */
function normalizeE164Tr(phoneRaw) {
  const raw = String(phoneRaw || '').trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    const only = digits.slice(1).replace(/[^\d]/g, '');
    if (only.startsWith('90') && only.length >= 12) return `+${only.slice(0, 12)}`;
    if (only.length >= 10) return `+${only}`;
    return null;
  }

  const only = digits.replace(/[^\d]/g, '');
  if (only.startsWith('90') && only.length >= 12) return `+${only.slice(0, 12)}`;
  if (only.startsWith('0') && only.length >= 11) return `+90${only.slice(1, 11)}`;
  if (only.length === 10 && only.startsWith('5')) return `+90${only}`;
  if (only.length === 11 && only.startsWith('5')) return `+90${only.slice(0, 10)}`;

  return only.length >= 10 ? `+${only}` : null;
}

/**
 * Veritabanına yazılacak telefon değeri.
 * Boş → undefined (veya emptyValue), geçersiz → null
 */
function normalizePhoneForDatabase(phoneRaw, { emptyValue = undefined } = {}) {
  const trimmed = String(phoneRaw ?? '').trim();
  if (!trimmed) return emptyValue;
  return normalizeE164Tr(trimmed);
}

function isValidTrPhone(phoneRaw) {
  return Boolean(normalizeE164Tr(phoneRaw));
}

module.exports = {
  normalizeE164Tr,
  normalizePhoneForDatabase,
  isValidTrPhone,
};

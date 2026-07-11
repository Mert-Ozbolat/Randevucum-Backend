/** WhatsApp: *kalın* — dinamik metinde * kaçır */
function waEscape(text) {
  return String(text ?? '')
    .trim()
    .replace(/\*/g, '·');
}

function waBold(text) {
  const safe = waEscape(text);
  return safe ? `*${safe}*` : '';
}

function waLine(label, value) {
  const v = waEscape(value);
  if (!v) return '';
  return `${waBold(label)}: ${v}`;
}

/** yyyy-MM-dd → 15.05.2026 */
function formatDateTr(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function toYmd(storedDay) {
  const y = storedDay.getUTCFullYear();
  const m = String(storedDay.getUTCMonth() + 1).padStart(2, '0');
  const d = String(storedDay.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildCustomerReminderMessage({ businessName, dateKey, time, serviceName }) {
  const lines = [
    `${waBold('Randevu hatırlatması')} 🔔`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    'Randevunuza zamanında gelmenizi rica ederiz. Görüşmek üzere! ✨',
  ];
  return lines.join('\n');
}

function buildCustomerReminderRsvpMessage({
  businessName,
  dateKey,
  time,
  serviceName,
  rsvpCode,
  interactive,
  reminderLabel,
}) {
  const code = waEscape(rsvpCode || '');
  const lines = [
    `${waBold(reminderLabel || 'Randevu hatırlatması')} 🔔`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    `${waBold('Randevunuza gelecek misiniz?')}`,
  ];

  if (interactive) {
    lines.push('', 'Lütfen aşağıdaki butonlardan birini seçin. Yanıtınız işletmeye bildirilecektir.');
  } else {
    lines.push(
      '',
      `✅ Geliyorum: ${waBold(`ONAY ${code}`)}`,
      `❌ İptal: ${waBold(`IPTAL ${code}`)}`,
      '',
      'Not: Yanıtınız işletmeye bildirilecektir.'
    );
  }

  return lines.join('\n');
}

function buildCustomerCancelConfirmMessage({ businessName, dateKey, time, serviceName, rsvpCode }) {
  const code = waEscape(rsvpCode || '');
  const lines = [
    `${waBold('İptal onayı')} ⚠️`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    'Randevunuzu iptal etmek istediğinizi anladım.',
    '',
    `Eminseniz şu mesajı gönderin: ${waBold(`IPTAL-ONAY ${code}`)}`,
    `Vazgeçmek için: ${waBold(`ONAY ${code}`)}`,
  ];
  return lines.join('\n');
}

function buildCustomer24hReminderMessage({ businessName, dateKey, time, serviceName }) {
  const lines = [
    `${waBold('Yarınki randevu hatırlatması')} 📅`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    'Randevunuza 24 saat kaldı. Görüşmek üzere! ✨',
  ];
  return lines.join('\n');
}

function buildBusinessReminderMessage({ customerName, customerPhone, dateKey, time, serviceName }) {
  const lines = [
    `${waBold('Yaklaşan randevu')} 📅`,
    '',
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    waLine('Müşteri', customerName || '—'),
  ];
  if (customerPhone && String(customerPhone).trim()) {
    lines.push(waLine('Telefon', customerPhone));
  }
  lines.push('', 'İyi çalışmalar!');
  return lines.join('\n');
}

function buildBusinessCustomerRsvpMessage({ customerName, dateKey, time, serviceName, rsvp, businessName }) {
  const rsvpLabel = rsvp === 'confirmed' ? 'Geliyor' : rsvp === 'canceled' ? 'İptal etti / gelmeyecek' : '—';
  const lines = [
    `${waBold('Müşteri yanıtı')} 💬`,
    '',
    waLine('İşletme', businessName || ''),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    waLine('Müşteri', customerName || '—'),
    waLine('Yanıt', rsvpLabel),
  ].filter(Boolean);
  return lines.join('\n');
}

function buildCustomerBookingMessage({ businessName, dateKey, time, serviceName, statusLabel }) {
  const lines = [
    `${waBold('Randevunuz alındı')} ✅`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
  ];
  if (statusLabel) {
    lines.push(waLine('Durum', statusLabel));
  }
  lines.push('', 'Randevu detaylarını panelinizden takip edebilirsiniz.');
  return lines.join('\n');
}

function buildCustomerApprovedMessage({ businessName, dateKey, time, serviceName }) {
  const lines = [
    `${waBold('Randevunuz onaylandı')} ✅`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    'Randevu saatinizde sizi bekliyoruz. Görüşmek üzere! ✨',
  ];
  return lines.join('\n');
}

function buildBusinessBookingMessage({
  customerName,
  customerPhone,
  dateKey,
  time,
  serviceName,
  staffName,
  panelUrl,
}) {
  const lines = [
    `${waBold('Yeni randevunuz var')} 🔔`,
    '',
    'Yeni bir randevu alındı.',
    '',
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
  ];
  if (staffName && String(staffName).trim()) {
    lines.push(waLine('Personel', staffName));
  }
  lines.push(waLine('Müşteri', customerName || '—'));
  if (customerPhone && String(customerPhone).trim()) {
    lines.push(waLine('Müşteri telefon', customerPhone));
  }
  if (panelUrl) {
    lines.push('', `👉 ${waEscape(panelUrl)}`);
  }
  lines.push('', 'Bu mesaj randevu oluşturulur oluşturulmaz gönderilmiştir.');
  return lines.join('\n');
}

function buildCustomerNoShowWarningMessage({
  businessName,
  dateKey,
  time,
  serviceName,
  attendanceRate,
  noShowCount,
  totalMarked,
  warningText,
}) {
  const lines = [
    `${waBold('Randevuya gelmediniz')} ⚠️`,
    '',
    waLine('İşletme', businessName || 'İşletme'),
    waLine('Tarih', formatDateTr(dateKey)),
    waLine('Saat', time),
    waLine('Hizmet', serviceName || 'Hizmet'),
    '',
    `${waBold('Katılım oranınız')}: %${attendanceRate}`,
    `Gelmediğiniz randevu: ${noShowCount} / ${totalMarked}`,
    '',
    warningText ||
      'Randevunuza gelemeyecekseniz lütfen önceden iptal edin. Tekrarlayan gelmeme durumunda hesabınız kısıtlanabilir.',
    '',
    'Randevularınızı panelinizden takip edebilirsiniz.',
  ];
  return lines.join('\n');
}

module.exports = {
  toYmd,
  formatDateTr,
  buildCustomerReminderMessage,
  buildCustomerReminderRsvpMessage,
  buildCustomerCancelConfirmMessage,
  buildCustomer24hReminderMessage,
  buildBusinessReminderMessage,
  buildBusinessCustomerRsvpMessage,
  buildCustomerBookingMessage,
  buildCustomerApprovedMessage,
  buildBusinessBookingMessage,
  buildCustomerNoShowWarningMessage,
};

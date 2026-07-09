const User = require('../models/User');
const Reservation = require('../models/Reservation');
const { sendWhatsApp, isEnabled: isWhatsAppEnabled } = require('./whatsapp');
const { buildCustomerNoShowWarningMessage } = require('./whatsappReservationMessages');
const { getAttendanceWarningMessage } = require('../utils/attendanceService');
const { waLog } = require('../utils/whatsappLog');
const { toYmd } = require('./whatsappReservationMessages');

async function resolveCustomerPhone(customer, customerId) {
  const fromPop = customer?.phone && String(customer.phone).trim();
  if (fromPop) return fromPop;
  if (!customerId) return null;
  const u = await User.findById(customerId).select('phone').lean();
  return u?.phone && String(u.phone).trim() ? String(u.phone).trim() : null;
}

/**
 * Müşteriye "gelmedi" işaretlendiğinde WhatsApp uyarısı gönder.
 */
async function sendNoShowWarningWhatsApp(reservationId) {
  if (!isWhatsAppEnabled()) {
    waLog('⚠️', 'WhatsApp kapalı — gelmedi uyarısı gönderilmedi', { reservationId: String(reservationId) });
    return { ok: false, reason: 'whatsapp_disabled' };
  }

  const r = await Reservation.findById(reservationId)
    .populate('businessId', 'name')
    .populate('serviceId', 'name')
    .populate('customerId', 'firstName lastName phone attendanceStats')
    .lean();

  if (!r) return { ok: false, reason: 'reservation_not_found' };

  const customer = r.customerId;
  const customerId = customer?._id || customer;
  const phone = await resolveCustomerPhone(customer, customerId);
  if (!phone) {
    waLog('⚠️', 'Müşteri telefonu yok — gelmedi uyarısı gönderilmedi', { reservationId: String(reservationId) });
    return { ok: false, reason: 'no_phone' };
  }

  const stats = customer?.attendanceStats || {};
  const warningText = getAttendanceWarningMessage(stats);
  const message = buildCustomerNoShowWarningMessage({
    businessName: r.businessId?.name || 'İşletme',
    dateKey: toYmd(r.date),
    time: r.time,
    serviceName: r.serviceId?.name || 'Hizmet',
    attendanceRate: stats.attendanceRate ?? 100,
    noShowCount: stats.noShowCount || 0,
    totalMarked: stats.totalMarked || 0,
    warningText,
  });

  try {
    await sendWhatsApp(phone, message);
    waLog('✅', 'Gelmedi uyarısı gönderildi', { reservationId: String(reservationId), phone });
    return { ok: true };
  } catch (err) {
    waLog('❌', 'Gelmedi uyarısı gönderilemedi', {
      reservationId: String(reservationId),
      error: err?.message || String(err),
    });
    return { ok: false, reason: 'send_failed', error: err?.message };
  }
}

module.exports = {
  sendNoShowWarningWhatsApp,
};

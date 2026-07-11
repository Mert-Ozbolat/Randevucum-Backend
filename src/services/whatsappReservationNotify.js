const Business = require('../models/Business');
const User = require('../models/User');
const Reservation = require('../models/Reservation');
const { sendWhatsApp, sendWhatsAppTemplate, isEnabled: isWhatsAppEnabled, getProvider } = require('./whatsapp');
const { RESERVATION_STATUS } = require('../config/constants');
const { getActivePlanForBusiness } = require('../utils/subscriptionLimits');
const {
  toYmd,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  buildCustomerBookingMessage,
  buildCustomerApprovedMessage,
  buildBusinessBookingMessage,
  formatDateTr,
} = require('./whatsappReservationMessages');
const { waLog } = require('../utils/whatsappLog');

async function isBusinessPro(businessId) {
  const { planKey, isActive } = await getActivePlanForBusiness(businessId);
  return isActive && planKey === 'pro';
}

async function resolveBusinessPhone(business) {
  const direct = business?.phone && String(business.phone).trim();
  if (direct) return direct;
  const ownerId = business?.ownerId?._id || business?.ownerId;
  if (!ownerId) return null;
  const owner = await User.findById(ownerId).select('phone').lean();
  return owner?.phone && String(owner.phone).trim() ? String(owner.phone).trim() : null;
}

async function resolveCustomerPhone(customer, customerId) {
  const fromPop = customer?.phone && String(customer.phone).trim();
  if (fromPop) return fromPop;
  if (!customerId) return null;
  const u = await User.findById(customerId).select('phone').lean();
  return u?.phone && String(u.phone).trim() ? String(u.phone).trim() : null;
}

function reservationStatusLabelTr(status) {
  if (status === RESERVATION_STATUS.APPROVED) return 'Onaylandı';
  if (status === RESERVATION_STATUS.PENDING) return 'Onay bekliyor';
  if (status === RESERVATION_STATUS.CANCELED) return 'İptal';
  return status || '';
}

function businessReservationsPanelUrl() {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) return '';
  return `${base}/dashboard/business/reservations`;
}

async function sendBusinessBookingWhatsApp({
  reservationId,
  businessPhone,
  customerName,
  customerPhone,
  dateKey,
  time,
  serviceName,
  staffName,
  panelUrl,
}) {
  const tag = `reservation:${reservationId}:business:booking`;
  const templateName = process.env.WHATSAPP_TEMPLATE_BOOKING_BUSINESS_NAME;

  if (getProvider() === 'meta' && templateName) {
    return sendWhatsAppTemplate({
      toPhone: businessPhone,
      templateName,
      bodyParams: [
        formatDateTr(dateKey),
        time,
        serviceName || 'Hizmet',
        customerName || '—',
        customerPhone || '—',
      ],
      tag,
    });
  }

  const msg = buildBusinessBookingMessage({
    customerName,
    customerPhone: customerPhone || '',
    dateKey,
    time,
    serviceName,
    staffName,
    panelUrl,
  });
  return sendWhatsApp({ toPhone: businessPhone, body: msg, tag });
}

/**
 * Randevu oluşturulunca anlık WhatsApp:
 * - İşletme sahibi: tüm işletmeler (telefon tanımlıysa)
 * - Müşteri: yalnızca PRO işletmeler
 */
async function sendReservationBookingWhatsApp(reservationId, { customerPhoneHint } = {}) {
  waLog('🆕', 'ANLIK randevu bildirimi başladı (POST /reservations)', {
    reservationId: String(reservationId),
    whatsappEnabled: isWhatsAppEnabled(),
  });

  const r = await Reservation.findById(reservationId)
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .populate('staffId', 'name title')
    .populate('customerId', 'firstName lastName phone')
    .lean();

  if (!r) {
    waLog('⚠️', 'Randevu bulunamadı — bildirim iptal', { reservationId: String(reservationId) });
    return { ok: false, reason: 'reservation_not_found' };
  }

  const businessId = r.businessId?._id || r.businessId;
  const business = r.businessId;
  const customer = r.customerId;
  const service = r.serviceId;
  const staff = r.staffId;
  const dateKey = toYmd(r.date);
  const panelUrl = businessReservationsPanelUrl();

  const customerPhone =
    (customerPhoneHint && String(customerPhoneHint).trim()) ||
    (await resolveCustomerPhone(customer, r.customerId?._id || r.customerId));

  const businessPhone = await resolveBusinessPhone(business);
  const customerName = customer
    ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
    : '';
  const staffName = staff?.name || staff?.title || '';

  const results = { customer: null, business: null };
  const isPro = businessId ? await isBusinessPro(businessId) : false;

  // İşletme — anlık (PRO şartı yok)
  if (r.reminders?.businessWhatsAppBookingSentAt) {
    results.business = { ok: true, skipped: true, reason: 'already_sent' };
    waLog('⏭️', 'İşletme anlık bildirimi daha önce gönderilmiş', { reservationId: String(r._id) });
  } else if (!businessPhone) {
    results.business = { ok: false, skipped: true, reason: 'no_business_phone' };
    waLog('📵', 'İşletme telefonu yok — anlık bildirim atlandı', {
      reservationId: String(r._id),
      hint: 'İşletme formunda veya işletme sahibi profilinde telefon tanımlayın',
    });
  } else if (businessPhone) {
    const res = await sendBusinessBookingWhatsApp({
      reservationId: r._id,
      businessPhone,
      customerName,
      customerPhone: customerPhone || '',
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
      staffName,
      panelUrl,
    });
    results.business = res;
    if (res.ok) {
      await Reservation.updateOne(
        { _id: r._id },
        { $set: { 'reminders.businessWhatsAppBookingSentAt': new Date() } }
      );
    }
  }

  waLog(results.business?.ok ? '✅' : results.business?.skipped ? '⏭️' : '❌', 'İşletme anlık bildirimi özeti', {
    reservationId: String(r._id),
    isPro,
    businessResult: results.business,
  });

  // Müşteri — randevu oluşturulunca (yalnızca PRO işletmeler)
  if (r.reminders?.customerWhatsAppBookingSentAt) {
    results.customer = { ok: true, skipped: true, reason: 'already_sent' };
  } else if (!isPro) {
    results.customer = { ok: true, skipped: true, reason: 'not_pro_business' };
  } else if (!customerPhone) {
    results.customer = { ok: false, skipped: true, reason: 'no_customer_phone' };
  } else {
    const msg = buildCustomerApprovedMessage({
      businessName: business?.name || 'İşletme',
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
    });
    const res = await sendWhatsApp({
      toPhone: customerPhone,
      body: msg,
      tag: `reservation:${r._id}:customer:booking`,
    });
    results.customer = res;
    if (res.ok) {
      await Reservation.updateOne(
        { _id: r._id },
        { $set: { 'reminders.customerWhatsAppBookingSentAt': new Date() } }
      );
    }
  }

  waLog(results.customer?.ok ? '✅' : results.customer?.skipped ? '⏭️' : '❌', 'Müşteri anlık bildirimi özeti', {
    reservationId: String(r._id),
    isPro,
    customerResult: results.customer,
  });

  waLog('🏁', 'ANLIK randevu bildirimi tamamlandı', {
    reservationId: String(r._id),
    customerResult: results.customer,
    businessResult: results.business,
  });

  return { ok: true, results };
}

/**
 * İşletme randevuyu onayladıktan sonra müşteriye WhatsApp:
 * - Yalnızca PRO işletmeler
 * - Aynı randevu için bir kez
 */
async function sendReservationApprovedWhatsApp(reservationId) {
  waLog('✅', 'ONAY WhatsApp bildirimi başladı (PATCH /reservations/:id/status)', {
    reservationId: String(reservationId),
    whatsappEnabled: isWhatsAppEnabled(),
  });

  const r = await Reservation.findById(reservationId)
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .populate('customerId', 'firstName lastName phone')
    .lean();

  if (!r) return { ok: false, reason: 'reservation_not_found' };
  if (r.status !== RESERVATION_STATUS.APPROVED) {
    return { ok: true, skipped: true, reason: 'not_approved' };
  }

  const businessId = r.businessId?._id || r.businessId;
  const business = r.businessId;
  const customer = r.customerId;
  const service = r.serviceId;
  const dateKey = toYmd(r.date);

  const isPro = businessId ? await isBusinessPro(businessId) : false;
  if (!isPro) {
    return { ok: true, skipped: true, reason: 'not_pro_business' };
  }

  if (r.reminders?.customerWhatsAppBookingSentAt) {
    return { ok: true, skipped: true, reason: 'already_sent' };
  }

  const customerPhone = await resolveCustomerPhone(customer, r.customerId?._id || r.customerId);
  if (!customerPhone) {
    return { ok: false, skipped: true, reason: 'no_customer_phone' };
  }

  const msg = buildCustomerApprovedMessage({
    businessName: business?.name || 'İşletme',
    dateKey,
    time: r.time,
    serviceName: service?.name || 'Hizmet',
  });

  const res = await sendWhatsApp({
    toPhone: customerPhone,
    body: msg,
    tag: `reservation:${r._id}:customer:approved`,
  });

  if (res.ok) {
    await Reservation.updateOne(
      { _id: r._id },
      { $set: { 'reminders.customerWhatsAppBookingSentAt': new Date() } }
    );
  }

  return res;
}

module.exports = {
  isBusinessPro,
  resolveBusinessPhone,
  resolveCustomerPhone,
  sendReservationBookingWhatsApp,
  sendReservationApprovedWhatsApp,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  toYmd,
};

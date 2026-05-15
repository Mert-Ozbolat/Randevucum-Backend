const Subscription = require('../models/Subscription');
const Business = require('../models/Business');
const User = require('../models/User');
const Reservation = require('../models/Reservation');
const { sendWhatsApp } = require('./whatsapp');
const { resolveProPriceIds } = require('../config/stripe');
const { RESERVATION_STATUS } = require('../config/constants');
const {
  toYmd,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  buildCustomerBookingMessage,
  buildBusinessBookingMessage,
} = require('./whatsappReservationMessages');

async function isBusinessPro(businessId, now = new Date()) {
  const proPriceIds = resolveProPriceIds();
  const proMatch = [{ planKey: 'pro' }];
  if (proPriceIds.length > 0) {
    proMatch.push({ stripePriceId: { $in: proPriceIds } });
  }
  const sub = await Subscription.findOne({
    businessId,
    status: 'active',
    endDate: { $gte: now },
    $or: proMatch,
  })
    .select('_id')
    .lean();
  return Boolean(sub);
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

/**
 * Randevu oluşturulunca müşteri + işletmeye WhatsApp (PRO işletmeler).
 */
async function sendReservationBookingWhatsApp(reservationId, { customerPhoneHint } = {}) {
  const r = await Reservation.findById(reservationId)
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .populate('customerId', 'firstName lastName phone')
    .lean();

  if (!r) return { ok: false, reason: 'reservation_not_found' };

  const businessId = r.businessId?._id || r.businessId;
  if (!businessId || !(await isBusinessPro(businessId))) {
    return { ok: true, skipped: true, reason: 'not_pro_business' };
  }

  const business = r.businessId;
  const customer = r.customerId;
  const service = r.serviceId;
  const dateKey = toYmd(r.date);

  const customerPhone =
    (customerPhoneHint && String(customerPhoneHint).trim()) ||
    (await resolveCustomerPhone(customer, r.customerId?._id || r.customerId));

  const businessPhone = await resolveBusinessPhone(business);
  const customerName = customer
    ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
    : '';

  const results = { customer: null, business: null };

  if (!r.reminders?.customerWhatsAppBookingSentAt) {
    const msg = buildCustomerBookingMessage({
      businessName: business?.name || 'İşletme',
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
      statusLabel: reservationStatusLabelTr(r.status),
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

  if (!r.reminders?.businessWhatsAppBookingSentAt) {
    const msg = buildBusinessBookingMessage({
      customerName,
      customerPhone: customerPhone || '',
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
    });
    const res = await sendWhatsApp({
      toPhone: businessPhone,
      body: msg,
      tag: `reservation:${r._id}:business:booking`,
    });
    results.business = res;
    if (res.ok) {
      await Reservation.updateOne(
        { _id: r._id },
        { $set: { 'reminders.businessWhatsAppBookingSentAt': new Date() } }
      );
    }
  }

  return { ok: true, results };
}

module.exports = {
  isBusinessPro,
  resolveBusinessPhone,
  resolveCustomerPhone,
  sendReservationBookingWhatsApp,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  toYmd,
};

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

function resolveStaffPhone(staff) {
  const direct = staff?.phone && String(staff.phone).trim();
  return direct || null;
}

/**
 * Randevu bildirimi alıcısı: atanmış personelin telefonu; yoksa işletme telefonu.
 */
async function resolveReservationNotifyPhone({ staff, business }) {
  const staffPhone = resolveStaffPhone(staff);
  if (staffPhone) {
    return {
      phone: staffPhone,
      recipient: 'staff',
      staffName: staff?.name || staff?.title || '',
    };
  }
  const businessPhone = await resolveBusinessPhone(business);
  return {
    phone: businessPhone,
    recipient: 'business',
    staffName: staff?.name || staff?.title || '',
  };
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

function businessReservationsPanelUrl(businessId) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) return '';
  const id = businessId ? String(businessId).trim() : '';
  if (id && /^[a-f0-9]{24}$/i.test(id)) {
    return `${base}/dashboard/business/reservations/${id}`;
  }
  return `${base}/dashboard/business/reservations`;
}

/** Meta URL butonu için dinamik yol eki (business MongoDB id) */
function businessReservationsPanelPathSuffix(businessId) {
  const id = businessId ? String(businessId).trim() : '';
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return '';
  return id;
}

function formatBusinessAddressLine(business) {
  const a = business?.address || {};
  const parts = [a.street, a.district, a.city, a.postalCode].map((p) => String(p || '').trim()).filter(Boolean);
  return parts.join(', ');
}

/** Meta Location header — yalnızca şablonda Location header varsa ve env açıksa */
function resolveBookingLocationHeader(business) {
  const enabled =
    String(process.env.WHATSAPP_TEMPLATE_BOOKING_USE_LOCATION_HEADER || '').toLowerCase() ===
    'true';
  if (!enabled) return null;
  return buildBusinessLocationHeader(business);
}

/** Meta Location header — işletme harita pini (lat/lng zorunlu) */
function buildBusinessLocationHeader(business) {
  const lat = business?.location?.lat;
  const lng = business?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const address = formatBusinessAddressLine(business) || String(business?.name || 'Isletme');
  return {
    latitude: lat,
    longitude: lng,
    name: String(business?.name || 'Isletme'),
    address,
  };
}

async function sendBusinessBookingWhatsApp({
  reservationId,
  businessId,
  business,
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
  const panelPathSuffix = businessReservationsPanelPathSuffix(businessId);
  const headerLocation = resolveBookingLocationHeader(business);

  if (getProvider() === 'meta' && templateName) {
    if (
      String(process.env.WHATSAPP_TEMPLATE_BOOKING_USE_LOCATION_HEADER || '').toLowerCase() ===
        'true' &&
      !headerLocation
    ) {
      waLog('⚠️', 'Isletme konumu yok — template Location header atlanacak', {
        tag,
        businessId: String(businessId || ''),
        hint: 'Isletme panelinde haritadan konum (pin) kaydedin.',
      });
    }
    return sendWhatsAppTemplate({
      toPhone: businessPhone,
      templateName,
      headerLocation: headerLocation || undefined,
      bodyParams: [
        formatDateTr(dateKey),
        time,
        serviceName || 'Hizmet',
        customerName || '—',
        customerPhone || '—',
      ],
      bodyParamNames: [
        'appointment_date',
        'appointment_time',
        'service_name',
        'customer_name',
        'customer_phone',
      ],
      urlButtons: panelPathSuffix
        ? [
            {
              index: 0,
              text: panelPathSuffix,
              parameterName: 'business_id',
            },
          ]
        : undefined,
      tag,
    });
  }

  if (getProvider() === 'meta' && !templateName) {
    waLog('⚠️', 'Meta session mesajı (işletme randevu) — template yok', {
      tag,
      to: businessPhone,
      hint: 'WHATSAPP_TEMPLATE_BOOKING_BUSINESS_NAME tanımlayın; aksi halde 24 saat kuralı dışında teslim edilmeyebilir.',
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

async function sendCustomerBookingWhatsApp({
  reservationId,
  businessName,
  business,
  customerPhone,
  dateKey,
  time,
  serviceName,
}) {
  const tag = `reservation:${reservationId}:customer:booking`;
  const templateName = process.env.WHATSAPP_TEMPLATE_BOOKING_CUSTOMER_NAME;
  const headerLocation = resolveBookingLocationHeader(business);

  if (getProvider() === 'meta' && templateName) {
    return sendWhatsAppTemplate({
      toPhone: customerPhone,
      templateName,
      headerLocation: headerLocation || undefined,
      bodyParams: [
        businessName || 'İşletme',
        formatDateTr(dateKey),
        time,
        serviceName || 'Hizmet',
      ],
      bodyParamNames: ['business_name', 'appointment_date', 'appointment_time', 'service_name'],
      tag,
    });
  }

  if (getProvider() === 'meta' && !templateName) {
    waLog('⚠️', 'Meta session mesajı (müşteri randevu) — template yok', {
      tag,
      to: customerPhone,
      hint: 'WHATSAPP_TEMPLATE_BOOKING_CUSTOMER_NAME tanımlayın; aksi halde 24 saat kuralı dışında teslim edilmeyebilir.',
    });
  }

  const msg = buildCustomerApprovedMessage({
    businessName,
    dateKey,
    time,
    serviceName,
  });
  return sendWhatsApp({ toPhone: customerPhone, body: msg, tag });
}

/**
 * Randevu oluşturulunca anlık WhatsApp:
 * - Atanan personel (telefonu varsa); yoksa işletme telefonu
 * - Müşteri: yalnızca PRO işletmeler
 */
async function sendReservationBookingWhatsApp(reservationId, { customerPhoneHint } = {}) {
  waLog('🆕', 'ANLIK randevu bildirimi başladı (POST /reservations)', {
    reservationId: String(reservationId),
    whatsappEnabled: isWhatsAppEnabled(),
  });

  const r = await Reservation.findById(reservationId)
    .populate('businessId', 'name phone ownerId address location')
    .populate('serviceId', 'name')
    .populate('staffId', 'name title phone')
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
  const panelUrl = businessReservationsPanelUrl(businessId);

  const customerPhone =
    (customerPhoneHint && String(customerPhoneHint).trim()) ||
    (await resolveCustomerPhone(customer, r.customerId?._id || r.customerId));

  const notifyTarget = await resolveReservationNotifyPhone({ staff, business });
  const notifyPhone = notifyTarget.phone;
  const customerName = customer
    ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
    : '';
  const staffName = staff?.name || staff?.title || '';

  const results = { customer: null, business: null };
  const isPro = businessId ? await isBusinessPro(businessId) : false;

  // Personel / işletme — anlık (PRO şartı yok)
  if (r.reminders?.businessWhatsAppBookingSentAt) {
    results.business = { ok: true, skipped: true, reason: 'already_sent' };
    waLog('⏭️', 'Personel/işletme anlık bildirimi daha önce gönderilmiş', { reservationId: String(r._id) });
  } else if (!notifyPhone) {
    results.business = { ok: false, skipped: true, reason: 'no_notify_phone' };
    waLog('📵', 'Bildirim telefonu yok — anlık bildirim atlandı', {
      reservationId: String(r._id),
      staffAssigned: Boolean(staff?._id || staff),
      hint: notifyTarget.recipient === 'staff'
        ? 'Atanan personel kaydına telefon ekleyin'
        : 'Personel atanmadıysa işletme veya sahip telefonu tanımlayın',
    });
  } else {
    const res = await sendBusinessBookingWhatsApp({
      reservationId: r._id,
      businessId,
      business,
      businessPhone: notifyPhone,
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

  waLog(results.business?.ok ? '✅' : results.business?.skipped ? '⏭️' : '❌', 'Personel/işletme anlık bildirimi özeti', {
    reservationId: String(r._id),
    isPro,
    notifyRecipient: notifyTarget.recipient,
    notifyPhone: notifyPhone ? '***' : null,
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
    const res = await sendCustomerBookingWhatsApp({
      reservationId: r._id,
      businessName: business?.name || 'İşletme',
      business,
      customerPhone,
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
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
  resolveStaffPhone,
  resolveReservationNotifyPhone,
  resolveCustomerPhone,
  sendReservationBookingWhatsApp,
  sendReservationApprovedWhatsApp,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  toYmd,
};

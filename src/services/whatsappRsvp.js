const Reservation = require('../models/Reservation');
const User = require('../models/User');
const { sendWhatsApp, sendWhatsAppTemplate, getProvider } = require('./whatsapp');
const { resolveBusinessPhone } = require('./whatsappReservationNotify');
const {
  toYmd,
  formatDateTr,
  buildBusinessCustomerRsvpMessage,
} = require('./whatsappReservationMessages');
const { normalizeE164Tr } = require('./whatsapp');
const { waLog } = require('../utils/whatsappLog');

function appointmentStartUtcFromStoredDay(storedDay, timeStr) {
  const tzOffsetMin = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES || 180);
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!storedDay || Number.isNaN(storedDay.getTime()) || !m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  const y = storedDay.getUTCFullYear();
  const mo = storedDay.getUTCMonth();
  const d = storedDay.getUTCDate();
  const hhLocal = Math.floor(mins / 60);
  const mmLocal = mins % 60;
  const utcMs = Date.UTC(y, mo, d, hhLocal, mmLocal, 0, 0) - tzOffsetMin * 60 * 1000;
  return new Date(utcMs);
}

function reservationRsvpCode(reservationId) {
  return String(reservationId).slice(-6).toUpperCase();
}

/** Meta buton / template payload: rsvp_yes_<id> | rsvp_no_<id> */
function buildRsvpButtonIds(reservationId) {
  const id = String(reservationId);
  return {
    yes: `rsvp_yes_${id}`,
    no: `rsvp_no_${id}`,
  };
}

function parseRsvpPayload(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;

  const meta = t.match(/^rsvp_(yes|no)_([a-f0-9]{24})$/i);
  if (meta) {
    return { action: meta[1] === 'yes' ? 'confirmed' : 'canceled', reservationId: meta[2] };
  }

  const upper = t.toUpperCase();
  const text = upper.match(/^(ONAY|IPTAL|IPTAL-ONAY)\s+([A-Z0-9]{3,12})\s*$/);
  if (!text) return null;

  if (text[1] === 'ONAY') return { action: 'confirmed', code: text[2] };
  if (text[1] === 'IPTAL' || text[1] === 'IPTAL-ONAY') return { action: 'canceled', code: text[2] };
  return null;
}

async function findCustomerUserByPhone(e164) {
  if (!e164) return null;
  const digits = e164.replace(/[^\d]/g, '');
  const last10 = digits.slice(-10);
  if (!last10) return null;
  return User.findOne({ phone: { $regex: `${last10}$` } }).select('_id phone firstName lastName').lean();
}

async function findApprovedReservationForRsvp({ userId, reservationId, code, now = new Date() }) {
  if (reservationId) {
    const r = await Reservation.findOne({
      _id: reservationId,
      customerId: userId,
      status: 'approved',
    })
      .populate('businessId', 'name phone ownerId')
      .populate('serviceId', 'name')
      .lean();
    if (!r) return null;
    const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
    if (!startAt || startAt <= now) return null;
    return r;
  }

  const candidates = await Reservation.find({
    customerId: userId,
    status: 'approved',
  })
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .lean();

  const match = candidates
    .map((r) => {
      const rCode = reservationRsvpCode(r._id);
      const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
      return { r, rCode, startAt };
    })
    .filter(({ rCode, startAt }) => rCode === String(code || '').toUpperCase() && startAt && startAt > now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];

  return match?.r || null;
}

async function notifyBusinessRsvp(r, user, rsvp) {
  const business = r.businessId;
  const businessPhone = await resolveBusinessPhone(business);
  if (!businessPhone) return;

  const customerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
  const dateKey = toYmd(r.date);
  const statusText = rsvp === 'confirmed' ? 'Gelecek' : 'Iptal etti';
  const templateName = process.env.WHATSAPP_TEMPLATE_RSVP_BUSINESS_NAME;

  if (getProvider() === 'meta' && templateName) {
    await sendWhatsAppTemplate({
      toPhone: businessPhone,
      templateName,
      bodyParams: [
        customerName || 'Musteri',
        statusText,
        formatDateTr(dateKey),
        r.time,
        r.serviceId?.name || 'Hizmet',
      ],
      bodyParamNames: [
        'customer_name',
        'rsvp_status',
        'appointment_date',
        'appointment_time',
        'service_name',
      ],
      tag: `reservation:${r._id}:business:rsvp`,
    });
    return;
  }

  const msg = buildBusinessCustomerRsvpMessage({
    businessName: business?.name || '',
    customerName,
    dateKey,
    time: r.time,
    serviceName: r.serviceId?.name || 'Hizmet',
    rsvp,
  });

  await sendWhatsApp({
    toPhone: businessPhone,
    body: msg,
    tag: `reservation:${r._id}:business:rsvp`,
  });
}

async function handleRsvpConfirmed(reservation, user, fromE164) {
  await Reservation.updateOne(
    { _id: reservation._id },
    {
      $set: {
        'reminders.customerRsvp': 'confirmed',
        'reminders.customerRsvpAt': new Date(),
        'reminders.cancelConfirmPendingAt': null,
        'reminders.businessRsvpNotifiedAt': new Date(),
      },
    }
  );

  await notifyBusinessRsvp(reservation, user, 'confirmed');

  if (fromE164) {
    await sendWhatsApp({
      toPhone: fromE164,
      body: 'Teşekkürler! Randevunuza geleceğiniz kaydedildi. Görüşmek üzere! ✅',
      tag: `reservation:${reservation._id}:customer:rsvp_ack`,
    });
  }

  waLog('✅', 'RSVP onaylandı (müşteri gelecek)', { reservationId: String(reservation._id) });
  return { ok: true, action: 'confirmed' };
}

async function handleRsvpCanceled(reservation, user, fromE164) {
  await Reservation.updateOne(
    { _id: reservation._id },
    {
      $set: {
        status: 'canceled',
        canceledAt: new Date(),
        canceledBy: user._id,
        'reminders.customerRsvp': 'canceled',
        'reminders.customerRsvpAt': new Date(),
        'reminders.cancelConfirmPendingAt': null,
        'reminders.businessRsvpNotifiedAt': new Date(),
      },
    }
  );

  await notifyBusinessRsvp(reservation, user, 'canceled');

  if (fromE164) {
    await sendWhatsApp({
      toPhone: fromE164,
      body: 'Randevunuz iptal edildi. Saat tekrar müsait hale geldi. İsterseniz yeni randevu alabilirsiniz.',
      tag: `reservation:${reservation._id}:customer:rsvp_cancel_ack`,
    });
  }

  waLog('❌', 'RSVP reddedildi — randevu iptal, slot boşaldı', { reservationId: String(reservation._id) });
  return { ok: true, action: 'canceled' };
}

/**
 * Gelen WhatsApp yanıtını işle (Meta buton, template quick reply veya metin ONAY/IPTAL).
 */
async function processIncomingRsvp({ fromPhone, payload }) {
  const parsed = parseRsvpPayload(payload);
  if (!parsed) return { ok: true, ignored: true, reason: 'not_rsvp' };

  const fromE164 = normalizeE164Tr(fromPhone);
  const user = await findCustomerUserByPhone(fromE164);
  if (!user?._id) return { ok: true, ignored: true, reason: 'user_not_found' };

  const reservation = await findApprovedReservationForRsvp({
    userId: user._id,
    reservationId: parsed.reservationId,
    code: parsed.code,
  });

  if (!reservation) {
    return { ok: true, ignored: true, reason: 'reservation_not_found' };
  }

  if (parsed.action === 'confirmed') {
    return handleRsvpConfirmed(reservation, user, fromE164);
  }

  return handleRsvpCanceled(reservation, user, fromE164);
}

module.exports = {
  appointmentStartUtcFromStoredDay,
  reservationRsvpCode,
  buildRsvpButtonIds,
  parseRsvpPayload,
  findCustomerUserByPhone,
  findApprovedReservationForRsvp,
  handleRsvpConfirmed,
  handleRsvpCanceled,
  processIncomingRsvp,
};

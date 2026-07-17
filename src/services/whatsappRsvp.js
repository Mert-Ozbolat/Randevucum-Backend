const Reservation = require('../models/Reservation');
const User = require('../models/User');
const { sendWhatsApp, sendWhatsAppTemplate, getProvider } = require('./whatsapp');
const { resolveReservationNotifyPhone } = require('./whatsappReservationNotify');
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

function normalizeRsvpText(raw) {
  return String(raw || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gelen RSVP metni / buton payload'ı.
 * - rsvp_yes_<ObjectId> / rsvp_no_<ObjectId>
 * - ONAY|IPTAL <kod>
 * - Buton başlığı / serbest metin: "Evet, geleceğim", "Hayır, iptal et" vb.
 */
function parseRsvpPayload(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;

  const meta = t.match(/^rsvp_(yes|no)_([a-f0-9]{24})$/i);
  if (meta) {
    return { action: meta[1] === 'yes' ? 'confirmed' : 'canceled', reservationId: meta[2] };
  }

  const upper = t.toUpperCase();
  const text = upper.match(/^(ONAY|IPTAL|IPTAL-ONAY)\s+([A-Z0-9]{3,12})\s*$/);
  if (text) {
    if (text[1] === 'ONAY') return { action: 'confirmed', code: text[2] };
    if (text[1] === 'IPTAL' || text[1] === 'IPTAL-ONAY') return { action: 'canceled', code: text[2] };
  }

  const n = normalizeRsvpText(t);

  const yesPhrases = [
    'evet gelecegim',
    'evet geleceğim',
    'evet',
    'gelecegim',
    'geleceğim',
    'geliyorum',
    'onay',
    'tamam',
    'yes',
  ];
  const noPhrases = [
    'hayir iptal et',
    'hayır iptal et',
    'hayir',
    'hayır',
    'iptal et',
    'iptal',
    'gelmeyecegim',
    'gelmeyeceğim',
    'gelmiyorum',
    'no',
  ];

  if (
    yesPhrases.includes(n) ||
    (/^evet\b/.test(n) && /gelece|geliyor|onay|tamam/.test(n))
  ) {
    return { action: 'confirmed', phraseOnly: true };
  }
  if (
    noPhrases.includes(n) ||
    (/^hay[iı]r\b/.test(n) && /iptal|gelme/.test(n))
  ) {
    return { action: 'canceled', phraseOnly: true };
  }

  // "Evet gelecegim" with slight typos / punctuation already normalized
  if (n.startsWith('evet') && n.length <= 40) {
    return { action: 'confirmed', phraseOnly: true };
  }
  if ((n.startsWith('hayir') || n.startsWith('hayır')) && n.length <= 40) {
    return { action: 'canceled', phraseOnly: true };
  }

  return null;
}

async function findCustomerUserByPhone(e164) {
  if (!e164) return null;
  const digits = e164.replace(/[^\d]/g, '');
  const last10 = digits.slice(-10);
  if (!last10) return null;
  return User.findOne({ phone: { $regex: `${last10}$` } }).select('_id phone firstName lastName').lean();
}

const RSVP_RESERVATION_POPULATE = [
  { path: 'businessId', select: 'name phone ownerId' },
  { path: 'serviceId', select: 'name' },
  { path: 'staffId', select: 'name title phone userId' },
];

/**
 * Serbest metin (Evet/Hayır) için: hatırlatma gönderilmiş, henüz RSVP yok (veya en yakın) randevu.
 */
async function findUpcomingRsvpReservationByPhrase({ userId, now = new Date() }) {
  const candidates = await Reservation.find({
    customerId: userId,
    status: 'approved',
    $or: [
      { 'reminders.customerWhatsAppSentAt': { $ne: null } },
      { 'reminders.customerWhatsApp24hSentAt': { $ne: null } },
    ],
  })
    .populate(RSVP_RESERVATION_POPULATE)
    .lean();

  const upcoming = candidates
    .map((r) => {
      const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
      return { r, startAt };
    })
    .filter(({ startAt }) => startAt && startAt > now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  if (!upcoming.length) return null;

  const pending = upcoming.find(({ r }) => !r.reminders?.customerRsvp);
  return (pending || upcoming[0]).r;
}

async function findApprovedReservationForRsvp({ userId, reservationId, code, phraseOnly, now = new Date() }) {
  if (reservationId) {
    const r = await Reservation.findOne({
      _id: reservationId,
      customerId: userId,
      status: 'approved',
    })
      .populate(RSVP_RESERVATION_POPULATE)
      .lean();
    if (!r) return null;
    const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
    if (!startAt || startAt <= now) return null;
    return r;
  }

  if (phraseOnly && !code) {
    return findUpcomingRsvpReservationByPhrase({ userId, now });
  }

  const candidates = await Reservation.find({
    customerId: userId,
    status: 'approved',
  })
    .populate(RSVP_RESERVATION_POPULATE)
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
  const customerPhone = user?.phone && String(user.phone).trim() ? String(user.phone).trim() : null;
  const notifyTarget = await resolveReservationNotifyPhone({
    staff: r.staffId,
    business,
    customerPhone,
  });
  const notifyPhone = notifyTarget.phone;
  if (!notifyPhone) {
    waLog('📵', 'RSVP personel/işletme bildirimi atlandı — telefon yok', {
      reservationId: String(r._id),
      staffId: r.staffId?._id ? String(r.staffId._id) : null,
    });
    return { ok: false, skipped: true, reason: 'no_notify_phone' };
  }

  const customerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
  const dateKey = toYmd(r.date);
  const statusText = rsvp === 'confirmed' ? 'Gelecek' : 'Iptal etti';
  const templateName = process.env.WHATSAPP_TEMPLATE_RSVP_BUSINESS_NAME;
  const tag = `reservation:${r._id}:${notifyTarget.recipient}:rsvp`;

  if (getProvider() === 'meta' && templateName) {
    const templateRes = await sendWhatsAppTemplate({
      toPhone: notifyPhone,
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
      tag,
    });
    if (templateRes?.ok || templateRes?.dryRun) {
      return templateRes;
    }
    waLog('⚠️', 'RSVP işletme şablonu başarısız — serbest metne düşülüyor', {
      reservationId: String(r._id),
      message: templateRes?.message,
      reason: templateRes?.reason,
    });
  }

  const msg = buildBusinessCustomerRsvpMessage({
    businessName: business?.name || '',
    customerName,
    dateKey,
    time: r.time,
    serviceName: r.serviceId?.name || 'Hizmet',
    rsvp,
  });

  return sendWhatsApp({
    toPhone: notifyPhone,
    body: msg,
    tag,
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
      },
    }
  );

  const notifyRes = await notifyBusinessRsvp(reservation, user, 'confirmed');
  if (notifyRes?.ok || notifyRes?.dryRun) {
    await Reservation.updateOne(
      { _id: reservation._id },
      { $set: { 'reminders.businessRsvpNotifiedAt': new Date() } }
    );
  } else {
    waLog('⚠️', 'Müşteri gelecek kaydedildi ama personel/işletme bildirimi başarısız', {
      reservationId: String(reservation._id),
      notifyRes,
    });
  }

  if (fromE164) {
    await sendWhatsApp({
      toPhone: fromE164,
      body: 'Teşekkürler! Randevunuza geleceğiniz kaydedildi. Görüşmek üzere! ✅',
      tag: `reservation:${reservation._id}:customer:rsvp_ack`,
    });
  }

  waLog('✅', 'RSVP onaylandı (müşteri gelecek)', {
    reservationId: String(reservation._id),
    staffNotified: Boolean(notifyRes?.ok || notifyRes?.dryRun),
    notifyRecipient: reservation.staffId?.name || 'business',
  });
  return { ok: true, action: 'confirmed', notified: Boolean(notifyRes?.ok || notifyRes?.dryRun) };
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
      },
    }
  );

  const notifyRes = await notifyBusinessRsvp(reservation, user, 'canceled');
  if (notifyRes?.ok || notifyRes?.dryRun) {
    await Reservation.updateOne(
      { _id: reservation._id },
      { $set: { 'reminders.businessRsvpNotifiedAt': new Date() } }
    );
  }

  if (fromE164) {
    await sendWhatsApp({
      toPhone: fromE164,
      body: 'Randevunuz iptal edildi. Saat tekrar müsait hale geldi. İsterseniz yeni randevu alabilirsiniz.',
      tag: `reservation:${reservation._id}:customer:rsvp_cancel_ack`,
    });
  }

  waLog('❌', 'RSVP reddedildi — randevu iptal, slot boşaldı', {
    reservationId: String(reservation._id),
    staffNotified: Boolean(notifyRes?.ok || notifyRes?.dryRun),
  });
  return { ok: true, action: 'canceled', notified: Boolean(notifyRes?.ok || notifyRes?.dryRun) };
}

/**
 * Gelen WhatsApp yanıtını işle (Meta buton, template quick reply veya metin ONAY/IPTAL / Evet-Hayır).
 */
async function processIncomingRsvp({ fromPhone, payload }) {
  const parsed = parseRsvpPayload(payload);
  if (!parsed) {
    waLog('↪️', 'Gelen mesaj RSVP değil', { payloadPreview: String(payload || '').slice(0, 80) });
    return { ok: true, ignored: true, reason: 'not_rsvp' };
  }

  const fromE164 = normalizeE164Tr(fromPhone);
  const user = await findCustomerUserByPhone(fromE164);
  if (!user?._id) {
    waLog('⚠️', 'RSVP — müşteri telefonu eşleşmedi', {
      from: fromE164 ? '***' : null,
      action: parsed.action,
    });
    return { ok: true, ignored: true, reason: 'user_not_found' };
  }

  const reservation = await findApprovedReservationForRsvp({
    userId: user._id,
    reservationId: parsed.reservationId,
    code: parsed.code,
    phraseOnly: Boolean(parsed.phraseOnly),
  });

  if (!reservation) {
    waLog('⚠️', 'RSVP — eşleşen randevu yok', {
      userId: String(user._id),
      action: parsed.action,
      phraseOnly: Boolean(parsed.phraseOnly),
      reservationId: parsed.reservationId || null,
      code: parsed.code || null,
    });
    return { ok: true, ignored: true, reason: 'reservation_not_found' };
  }

  waLog('📥', 'RSVP işleniyor', {
    reservationId: String(reservation._id),
    action: parsed.action,
    via: parsed.reservationId ? 'button_id' : parsed.code ? 'code' : 'phrase',
  });

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
  notifyBusinessRsvp,
};

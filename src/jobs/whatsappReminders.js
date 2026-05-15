const Reservation = require('../models/Reservation');
const Subscription = require('../models/Subscription');
const { sendWhatsApp } = require('../services/whatsapp');
const { resolveProPriceIds } = require('../config/stripe');
const {
  toYmd,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
} = require('../services/whatsappReservationMessages');
const {
  resolveBusinessPhone,
  resolveCustomerPhone,
} = require('../services/whatsappReservationNotify');

function parseTimeToMinutes(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function appointmentStartUtcFromStoredDay(storedDay, timeStr) {
  const tzOffsetMin = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES || 180);
  const mins = parseTimeToMinutes(timeStr);
  if (!storedDay || Number.isNaN(storedDay.getTime()) || mins === null) return null;
  const y = storedDay.getUTCFullYear();
  const mo = storedDay.getUTCMonth();
  const d = storedDay.getUTCDate();
  const hhLocal = Math.floor(mins / 60);
  const mmLocal = mins % 60;
  const utcMs = Date.UTC(y, mo, d, hhLocal, mmLocal, 0, 0) - tzOffsetMin * 60 * 1000;
  return new Date(utcMs);
}

async function runWhatsAppReminders({ now = new Date() } = {}) {
  const lookaheadMinutes = Number(
    process.env.WHATSAPP_REMINDER_LOOKAHEAD_MINUTES ||
      process.env.WHATSAPP_REMINDER_MINUTES_BEFORE ||
      60
  );
  const nowMs = now.getTime();
  const horizonMs = nowMs + Math.max(1, lookaheadMinutes) * 60 * 1000;

  const proPriceIds = resolveProPriceIds();
  const proMatch = [{ planKey: 'pro' }];
  if (proPriceIds.length > 0) {
    proMatch.push({ stripePriceId: { $in: proPriceIds } });
  }

  const proSubs = await Subscription.find({
    status: 'active',
    endDate: { $gte: now },
    $or: proMatch,
  })
    .select('businessId')
    .lean();

  const proBusinessIds = proSubs.map((s) => s.businessId);
  if (!proBusinessIds.length) {
    return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: 'no_pro_businesses' };
  }

  const candidates = await Reservation.find({
    businessId: { $in: proBusinessIds },
    status: { $in: ['pending', 'approved'] },
    $or: [
      { 'reminders.customerWhatsAppSentAt': null },
      { 'reminders.businessWhatsAppSentAt': null },
      { reminders: { $exists: false } },
    ],
  })
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .populate('customerId', 'firstName lastName phone')
    .sort({ date: 1, time: 1 })
    .lean();

  let sent = 0;
  let skipped = 0;
  let matchedWindow = 0;
  const sendAttempts = [];

  for (const r of candidates) {
    const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
    if (!startAt) {
      skipped += 1;
      continue;
    }
    const t = startAt.getTime();
    if (t <= nowMs || t > horizonMs) continue;
    matchedWindow += 1;

    const business = r.businessId;
    const customer = r.customerId;
    const service = r.serviceId;
    const dateKey = toYmd(r.date);
    const customerId = customer?._id || r.customerId;

    const updates = {};
    let anyAttempt = false;

    const customerPhone = await resolveCustomerPhone(customer, customerId);
    const businessPhone = await resolveBusinessPhone(business);

    if (!r.reminders?.customerWhatsAppSentAt) {
      anyAttempt = true;
      const msg = buildCustomerReminderMessage({
        businessName: business?.name || 'İşletme',
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
      });
      const res = await sendWhatsApp({
        toPhone: customerPhone,
        body: msg,
        tag: `reservation:${r._id}:customer:reminder`,
      });
      sendAttempts.push({
        reservationId: String(r._id),
        channel: 'customer',
        kind: 'reminder',
        ok: Boolean(res.ok),
        reason: res.reason || null,
        message: res.message ? String(res.message).slice(0, 200) : null,
        dryRun: Boolean(res.dryRun),
        hasPhone: Boolean(customerPhone),
      });
      if (res.ok) {
        updates['reminders.customerWhatsAppSentAt'] = new Date();
        sent += 1;
      } else {
        updates['reminders.lastError'] = `customer:${res.reason || 'send_failed'}`;
      }
    }

    if (!r.reminders?.businessWhatsAppSentAt) {
      anyAttempt = true;
      const customerName = customer
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
        : '';
      const msg = buildBusinessReminderMessage({
        customerName,
        customerPhone: customerPhone || '',
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
      });
      const res = await sendWhatsApp({
        toPhone: businessPhone,
        body: msg,
        tag: `reservation:${r._id}:business:reminder`,
      });
      sendAttempts.push({
        reservationId: String(r._id),
        channel: 'business',
        kind: 'reminder',
        ok: Boolean(res.ok),
        reason: res.reason || null,
        message: res.message ? String(res.message).slice(0, 200) : null,
        dryRun: Boolean(res.dryRun),
        hasPhone: Boolean(businessPhone),
      });
      if (res.ok) {
        updates['reminders.businessWhatsAppSentAt'] = new Date();
        sent += 1;
      } else {
        updates['reminders.lastError'] = `${updates['reminders.lastError'] || ''} business:${res.reason || 'send_failed'}`.trim();
      }
    }

    if (anyAttempt && Object.keys(updates).length) {
      await Reservation.updateOne({ _id: r._id }, { $set: updates });
    }
  }

  return {
    ok: true,
    scanned: candidates.length,
    matchedWindow,
    sent,
    skipped,
    sendAttempts,
    rule: {
      lookaheadMinutes,
      description:
        'Randevu başlangıcı şimdi ile şimdi+lookahead arasındaysa müşteri ve işletmeye hatırlatma (daha önce gönderilmediyse).',
    },
  };
}

module.exports = { runWhatsAppReminders };

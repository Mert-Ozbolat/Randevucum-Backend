const Reservation = require('../models/Reservation');
const Subscription = require('../models/Subscription');
const { sendWhatsApp, sendWhatsAppRsvpPrompt } = require('../services/whatsapp');
const { buildRsvpButtonIds } = require('../services/whatsappRsvp');
const { resolveProPriceIds } = require('../config/stripe');
const {
  toYmd,
  buildCustomerReminderMessage,
  buildBusinessReminderMessage,
  buildCustomerReminderRsvpMessage,
  buildCustomer24hReminderMessage,
  formatDateTr,
} = require('../services/whatsappReservationMessages');
const {
  resolveBusinessPhone,
  resolveCustomerPhone,
} = require('../services/whatsappReservationNotify');
const { waLog } = require('../utils/whatsappLog');

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
  const cronEveryMs = Number(process.env.REMINDER_CRON_EVERY_MS || 300000);
  const cronSlackMs = Math.max(60 * 1000, cronEveryMs + 15 * 1000);
  const dayMs = 24 * 60 * 60 * 1000;
  const target24hFromNowMs = nowMs + dayMs;
  const horizon24hMs = target24hFromNowMs + cronSlackMs;

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
    waLog(
      '⏰',
      'CRON hatırlatma — PRO işletme yok (reason: no_pro_businesses). Bu ANLIK yeni randevu bildirimi DEĞİL.',
      {
        hint: 'Anlık bildirim için konsolda 🆕 [WA] veya 🔔 [WA] arayın (randevu oluşturulunca)',
        proPriceIdsConfigured: proPriceIds.length,
      }
    );
    return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: 'no_pro_businesses' };
  }

  waLog('⏰', 'CRON hatırlatma job başladı (yaklaşan randevular)', {
    proBusinessCount: proBusinessIds.length,
    lookaheadMinutes,
  });

  const candidates = await Reservation.find({
    businessId: { $in: proBusinessIds },
    // Reminders should be for confirmed appointments only.
    status: 'approved',
    $or: [
      { 'reminders.customerWhatsAppSentAt': null },
      { 'reminders.customerWhatsApp24hSentAt': null },
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
    const inSoonWindow = t > nowMs && t <= horizonMs;
    const in24hWindow = t >= target24hFromNowMs && t <= horizon24hMs;
    if (!inSoonWindow && !in24hWindow) continue;
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

    // Exactly ~24h before (customer-only) — send once.
    if (in24hWindow && !r.reminders?.customerWhatsApp24hSentAt) {
      anyAttempt = true;
      const msg = buildCustomer24hReminderMessage({
        businessName: business?.name || 'İşletme',
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
      });
      const res = await sendWhatsApp({
        toPhone: customerPhone,
        body: msg,
        tag: `reservation:${r._id}:customer:reminder_24h`,
      });
      sendAttempts.push({
        reservationId: String(r._id),
        channel: 'customer',
        kind: 'reminder_24h',
        ok: Boolean(res.ok),
        reason: res.reason || null,
        message: res.message ? String(res.message).slice(0, 200) : null,
        dryRun: Boolean(res.dryRun),
        hasPhone: Boolean(customerPhone),
      });
      if (res.ok) {
        updates['reminders.customerWhatsApp24hSentAt'] = new Date();
        sent += 1;
      } else {
        updates['reminders.lastError'] = `${updates['reminders.lastError'] || ''} customer24h:${res.reason || 'send_failed'}`.trim();
      }
    }

    if (!r.reminders?.customerWhatsAppSentAt) {
      if (!inSoonWindow) {
        // Don't send the "soon" reminder when we're only in the 24h window.
      } else {
      anyAttempt = true;
      const rsvpCode = String(r._id).slice(-6).toUpperCase();
      const buttonIds = buildRsvpButtonIds(r._id);
      const businessName = business?.name || 'İşletme';
      const serviceName = service?.name || 'Hizmet';
      const msg = buildCustomerReminderRsvpMessage({
        businessName,
        dateKey,
        time: r.time,
        serviceName,
        rsvpCode,
        interactive: true,
      });
      const textFallbackBody = buildCustomerReminderRsvpMessage({
        businessName,
        dateKey,
        time: r.time,
        serviceName,
        rsvpCode,
        interactive: false,
      });
      const res = await sendWhatsAppRsvpPrompt({
        toPhone: customerPhone,
        body: msg,
        textFallbackBody,
        yesButtonId: buttonIds.yes,
        noButtonId: buttonIds.no,
        templateBodyParams: [
          businessName,
          formatDateTr(dateKey),
          r.time,
          serviceName,
        ],
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
    }

    if (!r.reminders?.businessWhatsAppSentAt) {
      if (!inSoonWindow) {
        // Business reminder is for near-term window only.
      } else {
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

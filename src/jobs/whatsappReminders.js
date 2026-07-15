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
  formatDateTr,
} = require('../services/whatsappReservationMessages');
const {
  resolveReservationNotifyPhone,
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

function buildRsvpReminderTemplateConfig({ kind, businessName, dateKey, time, serviceName }) {
  const specificName =
    kind === '24h'
      ? process.env.WHATSAPP_TEMPLATE_RSVP_24H_NAME
      : process.env.WHATSAPP_TEMPLATE_RSVP_1H_NAME;
  const legacyName = process.env.WHATSAPP_TEMPLATE_RSVP_NAME;
  const dateText = formatDateTr(dateKey);

  if (specificName) {
    return {
      templateName: specificName,
      templateBodyParams: [
        kind === '24h' ? 'Yarin' : '1 saat icinde',
        businessName,
        dateText,
        time,
        serviceName,
      ],
      templateBodyParamNames: [
        'reminder_timing',
        'business_name',
        'appointment_date',
        'appointment_time',
        'service_name',
      ],
    };
  }

  if (legacyName) {
    return {
      templateName: legacyName,
      templateBodyParams: [businessName, dateText, time, serviceName],
      templateBodyParamNames: [
        'business_name',
        'appointment_date',
        'appointment_time',
        'service_name',
      ],
    };
  }

  return {};
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

  const proBusinessIdSet = new Set(proSubs.map((s) => String(s.businessId)));

  waLog('⏰', 'CRON hatırlatma job başladı (yaklaşan randevular)', {
    proBusinessCount: proBusinessIdSet.size,
    lookaheadMinutes,
    note: 'Müşteri hatırlatması tüm onaylı randevularda; personel/işletme hatırlatması yalnızca PRO',
  });

  const candidates = await Reservation.find({
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
    .populate('staffId', 'name title phone userId')
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
    const businessIdKey = String(business?._id || r.businessId || '');
    const isProBusiness = proBusinessIdSet.has(businessIdKey);

    const updates = {};
    let anyAttempt = false;

    const customerPhone = await resolveCustomerPhone(customer, customerId);
    const notifyTarget = await resolveReservationNotifyPhone({
      staff: r.staffId,
      business,
      customerPhone,
    });
    const notifyPhone = notifyTarget.phone;

    // Exactly ~24h before (customer-only) — ask RSVP once. PRO gerekmez.
    if (in24hWindow && !r.reminders?.customerWhatsApp24hSentAt) {
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
        reminderLabel: 'Yarınki randevu hatırlatması',
      });
      const textFallbackBody = buildCustomerReminderRsvpMessage({
        businessName,
        dateKey,
        time: r.time,
        serviceName,
        rsvpCode,
        interactive: false,
        reminderLabel: 'Yarınki randevu hatırlatması',
      });
      const templateConfig = buildRsvpReminderTemplateConfig({
        kind: '24h',
        businessName,
        dateKey,
        time: r.time,
        serviceName,
      });
      const res = await sendWhatsAppRsvpPrompt({
        toPhone: customerPhone,
        body: msg,
        textFallbackBody,
        yesButtonId: buttonIds.yes,
        noButtonId: buttonIds.no,
        ...templateConfig,
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
      const templateConfig = buildRsvpReminderTemplateConfig({
        kind: '1h',
        businessName,
        dateKey,
        time: r.time,
        serviceName,
      });
      const res = await sendWhatsAppRsvpPrompt({
        toPhone: customerPhone,
        body: msg,
        textFallbackBody,
        yesButtonId: buttonIds.yes,
        noButtonId: buttonIds.no,
        ...templateConfig,
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

    // Personel/işletme hatırlatması — yalnızca PRO
    if (!r.reminders?.businessWhatsAppSentAt) {
      if (!inSoonWindow) {
        // Business reminder is for near-term window only.
      } else if (!isProBusiness) {
        anyAttempt = true;
        updates['reminders.businessWhatsAppSentAt'] = new Date();
        sendAttempts.push({
          reservationId: String(r._id),
          channel: 'business',
          kind: 'reminder',
          ok: true,
          skipped: true,
          reason: 'not_pro_business',
          hasPhone: Boolean(notifyPhone),
        });
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
        toPhone: notifyPhone,
        body: msg,
        tag: `reservation:${r._id}:${notifyTarget.recipient}:reminder`,
      });
      sendAttempts.push({
        reservationId: String(r._id),
        channel: notifyTarget.recipient,
        kind: 'reminder',
        ok: Boolean(res.ok),
        reason: res.reason || null,
        message: res.message ? String(res.message).slice(0, 200) : null,
        dryRun: Boolean(res.dryRun),
        hasPhone: Boolean(notifyPhone),
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
        'Müşteri hatırlatması her zaman; personel/işletme hatırlatması yalnızca PRO (yaklaşan pencere).',
    },
  };
}

module.exports = { runWhatsAppReminders };

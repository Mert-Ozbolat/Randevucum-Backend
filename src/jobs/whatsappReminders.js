const Reservation = require('../models/Reservation');
const Subscription = require('../models/Subscription');
const Business = require('../models/Business');
const { sendWhatsApp } = require('../services/whatsapp');

function parseTimeToMinutes(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function appointmentStartUtcFromStoredDay(storedDay, timeStr) {
  // Reservation day is stored at 12:00 UTC to keep calendar day stable.
  // Business is assumed Europe/Istanbul (UTC+3, no DST). We convert local time to UTC by subtracting 3 hours.
  const tzOffsetMin = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES || 180); // 180 = UTC+3
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

function buildCustomerMessage({ businessName, dateKey, time, serviceName }) {
  return (
    `Hatırlatma: ${businessName} için randevunuz yaklaşıyor.\n` +
    `Tarih: ${dateKey} Saat: ${time}\n` +
    `Hizmet: ${serviceName}\n` +
    `Görüşmek üzere.`
  );
}

function buildBusinessMessage({ customerName, customerPhone, dateKey, time, serviceName }) {
  const phoneLine = customerPhone ? `\nMüşteri tel: ${customerPhone}` : '';
  return (
    `Hatırlatma: Yaklaşan randevu.\n` +
    `Tarih: ${dateKey} Saat: ${time}\n` +
    `Hizmet: ${serviceName}\n` +
    `Müşteri: ${customerName || '-'}` +
    phoneLine
  );
}

function toYmd(storedDay) {
  // storedDay is UTC day; format yyyy-MM-dd using UTC parts
  const y = storedDay.getUTCFullYear();
  const m = String(storedDay.getUTCMonth() + 1).padStart(2, '0');
  const d = String(storedDay.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function runWhatsAppReminders({ now = new Date() } = {}) {
  const minutesBefore = Number(process.env.WHATSAPP_REMINDER_MINUTES_BEFORE || 60);
  const windowMinutes = Number(process.env.WHATSAPP_REMINDER_WINDOW_MINUTES || 10);

  const fromMs = now.getTime() + minutesBefore * 60 * 1000;
  const toMs = fromMs + windowMinutes * 60 * 1000;

  // Find active PRO subscriptions
  const proSubs = await Subscription.find({
    status: 'active',
    planKey: 'pro',
    endDate: { $gte: now },
  })
    .select('businessId')
    .lean();

  const proBusinessIds = proSubs.map((s) => s.businessId);
  if (!proBusinessIds.length) {
    return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: 'no_pro_businesses' };
  }

  // Pull candidate reservations (we'll compute exact time window in JS)
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

  for (const r of candidates) {
    const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
    if (!startAt) {
      skipped += 1;
      continue;
    }
    const t = startAt.getTime();
    if (t < fromMs || t >= toMs) continue;

    const business = r.businessId;
    const customer = r.customerId;
    const service = r.serviceId;
    const dateKey = toYmd(r.date);

    const updates = {};
    let anyAttempt = false;

    // Customer reminder
    if (!r.reminders?.customerWhatsAppSentAt) {
      anyAttempt = true;
      const customerPhone = customer?.phone;
      const msg = buildCustomerMessage({
        businessName: business?.name || 'İşletme',
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
      });
      const res = await sendWhatsApp({
        toPhone: customerPhone,
        body: msg,
        tag: `reservation:${r._id}:customer`,
      });
      if (res.ok) {
        updates['reminders.customerWhatsAppSentAt'] = new Date();
        sent += 1;
      } else {
        updates['reminders.lastError'] = `customer:${res.reason || 'send_failed'}`;
      }
    }

    // Business reminder (send to business phone; fallback to owner's phone if present)
    if (!r.reminders?.businessWhatsAppSentAt) {
      anyAttempt = true;
      let businessPhone = business?.phone;
      if (!businessPhone) {
        const bizRow = await Business.findById(business?._id).select('ownerId').lean();
        if (bizRow?.ownerId) {
          // ownerId is a User; we can populate phone from reservation populate? not available here
          // (optional) keep as null; skip if no phone configured.
        }
      }

      const customerName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : '';
      const msg = buildBusinessMessage({
        customerName,
        customerPhone: customer?.phone || '',
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
      });
      const res = await sendWhatsApp({
        toPhone: businessPhone,
        body: msg,
        tag: `reservation:${r._id}:business`,
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

  return { ok: true, scanned: candidates.length, sent, skipped, window: { minutesBefore, windowMinutes } };
}

module.exports = { runWhatsAppReminders };


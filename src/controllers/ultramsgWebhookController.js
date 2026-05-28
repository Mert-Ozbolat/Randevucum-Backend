const Reservation = require('../models/Reservation');
const User = require('../models/User');
const Business = require('../models/Business');
const { asyncHandler } = require('../utils/errors');
const { success } = require('../utils/response');
const { normalizeE164Tr } = require('../services/whatsapp');
const { sendWhatsApp } = require('../services/whatsapp');
const { resolveBusinessPhone } = require('../services/whatsappReservationNotify');
const {
  toYmd,
  buildBusinessCustomerRsvpMessage,
  buildCustomerCancelConfirmMessage,
} = require('../services/whatsappReservationMessages');

function extractUltraMsgIncoming(reqBody) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const eventType = body.event_type || body.eventType || body.type || '';
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const from = data.from || body.from || '';
  const text = data.body || body.body || data.text || '';
  return { eventType: String(eventType), from: String(from), text: String(text) };
}

function normalizeUltraMsgFrom(from) {
  const raw = String(from || '').trim();
  // Examples:
  // 905xxxxxxxxx@c.us
  // +905xxxxxxxxx
  const withoutSuffix = raw.replace(/@c\.us$/i, '').trim();
  const digitsOrPlus = withoutSuffix.replace(/[^\d+]/g, '');
  return normalizeE164Tr(digitsOrPlus);
}

function parseRsvpCommand(text) {
  const t = String(text || '').trim().toUpperCase();
  // Expected:
  // ONAY ABC123
  // IPTAL ABC123
  // IPTAL-ONAY ABC123
  const m = t.match(/^(ONAY|IPTAL|IPTAL-ONAY)\s+([A-Z0-9]{3,12})\s*$/);
  if (!m) return null;
  const kind =
    m[1] === 'ONAY' ? 'confirmed' : m[1] === 'IPTAL-ONAY' ? 'canceled_confirmed' : 'canceled_requested';
  const code = m[2];
  return { kind, code };
}

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

async function findCustomerUserByPhone(e164) {
  if (!e164) return null;
  const digits = e164.replace(/[^\d]/g, '');
  const last10 = digits.slice(-10);
  if (!last10) return null;
  return User.findOne({ phone: { $regex: `${last10}$` } }).select('_id phone firstName lastName').lean();
}

exports.ultramsgIncoming = asyncHandler(async (req, res) => {
  const { eventType, from, text } = extractUltraMsgIncoming(req.body);
  if (eventType && eventType !== 'message_received') {
    return success(res, 200, { ok: true, ignored: true, eventType }, 'OK');
  }

  const fromE164 = normalizeUltraMsgFrom(from);
  const cmd = parseRsvpCommand(text);
  if (!fromE164 || !cmd) {
    // Always 200 so UltraMsg doesn't retry forever.
    return success(
      res,
      200,
      { ok: true, ignored: true, from: from ? '(present)' : '(missing)', hasCommand: Boolean(cmd) },
      'OK'
    );
  }

  const user = await findCustomerUserByPhone(fromE164);
  if (!user?._id) {
    return success(res, 200, { ok: true, ignored: true, reason: 'user_not_found' }, 'OK');
  }

  const now = new Date();
  const code = cmd.code;

  // Find the matching approved reservation for this customer by code (last 6 of _id)
  const candidates = await Reservation.find({
    customerId: user._id,
    status: 'approved',
  })
    .populate('businessId', 'name phone ownerId')
    .populate('serviceId', 'name')
    .lean();

  const match = candidates
    .map((r) => {
      const id = String(r._id);
      const rCode = id.slice(-6).toUpperCase();
      const startAt = appointmentStartUtcFromStoredDay(r.date, r.time);
      return { r, rCode, startAt };
    })
    .filter(({ rCode, startAt }) => rCode === code && startAt && startAt > now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];

  if (!match?.r) {
    return success(res, 200, { ok: true, ignored: true, reason: 'reservation_not_found' }, 'OK');
  }

  const r = match.r;
  const dateKey = toYmd(r.date);
  const business = r.businessId;
  const service = r.serviceId;

  const customerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';

  // 1) Customer confirms coming
  if (cmd.kind === 'confirmed') {
    await Reservation.updateOne(
      { _id: r._id },
      {
        $set: {
          'reminders.customerRsvp': 'confirmed',
          'reminders.customerRsvpAt': new Date(),
          'reminders.cancelConfirmPendingAt': null,
        },
      }
    );

    const businessPhone = await resolveBusinessPhone(business);
    if (businessPhone) {
      const msg = buildBusinessCustomerRsvpMessage({
        businessName: business?.name || '',
        customerName,
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
        rsvp: 'confirmed',
      });
      await sendWhatsApp({
        toPhone: businessPhone,
        body: msg,
        tag: `reservation:${r._id}:business:rsvp`,
      });
    }

    await sendWhatsApp({
      toPhone: fromE164,
      body: 'Yanıtınız alındı: randevuya geleceksiniz. Teşekkürler!',
      tag: `reservation:${r._id}:customer:rsvp_ack`,
    });

    void Business;
    return success(res, 200, { ok: true }, 'OK');
  }

  // 2) Customer requests cancellation (step 1)
  if (cmd.kind === 'canceled_requested') {
    await Reservation.updateOne(
      { _id: r._id },
      {
        $set: {
          'reminders.cancelConfirmPendingAt': new Date(),
          'reminders.customerRsvp': null,
          'reminders.customerRsvpAt': null,
        },
      }
    );

    const msg = buildCustomerCancelConfirmMessage({
      businessName: business?.name || 'İşletme',
      dateKey,
      time: r.time,
      serviceName: service?.name || 'Hizmet',
      rsvpCode: code,
    });

    await sendWhatsApp({
      toPhone: fromE164,
      body: msg,
      tag: `reservation:${r._id}:customer:cancel_confirm`,
    });

    void Business;
    return success(res, 200, { ok: true }, 'OK');
  }

  // 3) Customer confirms cancellation (step 2)
  const pendingAt = r.reminders?.cancelConfirmPendingAt ? new Date(r.reminders.cancelConfirmPendingAt) : null;
  const pendingFresh =
    pendingAt && Number.isFinite(pendingAt.getTime()) && now.getTime() - pendingAt.getTime() <= 15 * 60 * 1000;

  if (cmd.kind === 'canceled_confirmed' && pendingFresh) {
    await Reservation.updateOne(
      { _id: r._id },
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

    const businessPhone = await resolveBusinessPhone(business);
    if (businessPhone) {
      const msg = buildBusinessCustomerRsvpMessage({
        businessName: business?.name || '',
        customerName,
        dateKey,
        time: r.time,
        serviceName: service?.name || 'Hizmet',
        rsvp: 'canceled',
      });
      await sendWhatsApp({
        toPhone: businessPhone,
        body: msg,
        tag: `reservation:${r._id}:business:rsvp`,
      });
    }

    await sendWhatsApp({
      toPhone: fromE164,
      body: 'İptal onaylandı: randevunuz iptal edildi. İsterseniz tekrar randevu alabilirsiniz.',
      tag: `reservation:${r._id}:customer:rsvp_ack`,
    });

    void Business;
    return success(res, 200, { ok: true }, 'OK');
  }

  // If customer tried IPTAL-ONAY without step 1 (or too late), ask again.
  if (cmd.kind === 'canceled_confirmed' && !pendingFresh) {
    await sendWhatsApp({
      toPhone: fromE164,
      body: `İptal için önce \"IPTAL ${code}\" yazın; ardından onay mesajı isteyeceğiz.`,
      tag: `reservation:${r._id}:customer:cancel_requires_step1`,
    });
    void Business;
    return success(res, 200, { ok: true }, 'OK');
  }

  // If canceled, optionally notify business record (no-op, already messaged above)
  void Business; // keep import referenced (future extensions)

  return success(res, 200, { ok: true }, 'OK');
});


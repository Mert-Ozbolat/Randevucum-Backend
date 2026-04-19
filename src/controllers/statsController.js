const Presence = require('../models/Presence');
const Reservation = require('../models/Reservation');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { RESERVATION_STATUS } = require('../config/constants');
const { reservationDayToStoredDate, nextReservationDayStoredDate } = require('../utils/calendarDate');

/** Son X dakikada ping atan benzersiz oturum = “aktif” */
const ACTIVE_MINUTES = 5;

function todayStoredRange() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const ymd = `${y}-${mo}-${d}`;
  const start = reservationDayToStoredDate(ymd);
  const end = nextReservationDayStoredDate(start);
  return { start, end };
}

function timeToMinutes(t) {
  const parts = String(t || '').split(':');
  if (parts.length < 2) return NaN;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

/**
 * Şu an çalışma saatleri içinde mi (sunucu yerel saati, dayOfWeek: 0=Pazar).
 */
function isBusinessOpenNow(workingHours, now = new Date()) {
  if (!Array.isArray(workingHours) || workingHours.length === 0) return false;
  const dow = now.getDay();
  const dayCfg = workingHours.find((w) => w.dayOfWeek === dow);
  if (!dayCfg || dayCfg.isClosed) return false;
  const openM = timeToMinutes(dayCfg.open);
  const closeM = timeToMinutes(dayCfg.close);
  if (Number.isNaN(openM) || Number.isNaN(closeM)) return false;
  if (closeM < openM) return false; // gece vardiyası — MVP’de sayma
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= openM && cur <= closeM;
}

/**
 * GET /stats/home
 */
exports.getHomeStats = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - ACTIVE_MINUTES * 60 * 1000);

  const [activeUsers, todayReservations, businesses] = await Promise.all([
    Presence.countDocuments({ lastPing: { $gte: since } }),
    (async () => {
      const { start, end } = todayStoredRange();
      if (!start || !end) return 0;
      return Reservation.countDocuments({
        date: { $gte: start, $lt: end },
        status: { $ne: RESERVATION_STATUS.CANCELED },
      });
    })(),
    Business.find({ isActive: true }).select('workingHours').lean(),
  ]);

  const openBusinesses = businesses.filter((b) => isBusinessOpenNow(b.workingHours)).length;

  return success(
    res,
    200,
    {
      activeUsers,
      todayReservations,
      openBusinesses,
      activeWindowMinutes: ACTIVE_MINUTES,
      updatedAt: new Date().toISOString(),
    },
    'OK'
  );
});

/**
 * POST /stats/presence — X-Presence-Id: uuid (zorunlu)
 */
exports.postPresence = asyncHandler(async (req, res) => {
  const raw = (req.headers['x-presence-id'] || req.body?.sessionId || '').trim();
  if (!raw || raw.length > 64) {
    return error(res, 400, 'X-Presence-Id başlığı (veya sessionId) gerekli.');
  }

  const sessionId = raw.slice(0, 64);
  const userId = req.user?._id || null;

  await Presence.findOneAndUpdate(
    { sessionId },
    {
      $set: { lastPing: new Date(), userId },
      $setOnInsert: { sessionId },
    },
    { upsert: true, new: true }
  );

  return success(res, 200, { ok: true }, 'OK');
});

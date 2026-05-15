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

/**
 * GET /stats/home
 */
exports.getHomeStats = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - ACTIVE_MINUTES * 60 * 1000);

  const [activeUsers, todayReservations, registeredBusinesses] = await Promise.all([
    Presence.countDocuments({ lastPing: { $gte: since } }),
    (async () => {
      const { start, end } = todayStoredRange();
      if (!start || !end) return 0;
      return Reservation.countDocuments({
        date: { $gte: start, $lt: end },
        status: { $ne: RESERVATION_STATUS.CANCELED },
      });
    })(),
    Business.countDocuments({ isActive: { $ne: false } }),
  ]);

  return success(
    res,
    200,
    {
      activeUsers,
      todayReservations,
      registeredBusinesses,
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

const Presence = require('../models/Presence');
const Reservation = require('../models/Reservation');
const Business = require('../models/Business');
const mongoose = require('mongoose');
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

function parseYmdOrNull(ymd) {
  const s = String(ymd || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return s;
}

function moneyFromService(service) {
  const p = service?.price;
  const min = service?.priceMin;
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  if (typeof min === 'number' && Number.isFinite(min)) return min;
  return 0;
}

/**
 * GET /stats/business/:businessId/analytics?from=yyyy-MM-dd&to=yyyy-MM-dd
 * - Daily revenue (last 30d default)
 * - Busiest hour
 * - Top staff (by reservation count)
 * - Cancel rate
 * - New customers count
 * - Returning customer rate
 */
exports.getBusinessAnalytics = asyncHandler(async (req, res) => {
  const businessId = req.params.businessId;
  if (!businessId || !mongoose.isValidObjectId(businessId)) {
    return error(res, 400, 'Invalid businessId.');
  }

  const fromQ = parseYmdOrNull(req.query?.from);
  const toQ = parseYmdOrNull(req.query?.to);

  // Default: last 30 days (including today)
  const today = new Date();
  const toYmd =
    toQ ||
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const toStored = reservationDayToStoredDate(toYmd);
  const toEnd = nextReservationDayStoredDate(toStored);

  const fromDate = new Date(toStored.getTime() - 29 * 24 * 60 * 60 * 1000);
  const fromYmd =
    fromQ ||
    `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}-${String(fromDate.getUTCDate()).padStart(2, '0')}`;
  const fromStored = reservationDayToStoredDate(fromYmd);

  const matchRange = {
    businessId: new mongoose.Types.ObjectId(businessId),
    date: { $gte: fromStored, $lt: toEnd },
  };

  // Base set: all reservations in range
  const [totals, hourAgg, staffAgg, dailyAgg, customersInRange] = await Promise.all([
    Reservation.aggregate([
      { $match: matchRange },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    // busiest hour (approved only)
    Reservation.aggregate([
      { $match: { ...matchRange, status: RESERVATION_STATUS.APPROVED } },
      {
        $addFields: {
          hour: { $substrBytes: ['$time', 0, 2] },
        },
      },
      { $group: { _id: '$hour', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]),
    // best staff (approved only)
    Reservation.aggregate([
      { $match: { ...matchRange, status: RESERVATION_STATUS.APPROVED, staffId: { $ne: null } } },
      { $group: { _id: '$staffId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'staff',
          localField: '_id',
          foreignField: '_id',
          as: 'staff',
        },
      },
      { $unwind: { path: '$staff', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          staffId: '$_id',
          count: 1,
          name: '$staff.name',
          title: '$staff.title',
        },
      },
    ]),
    // daily revenue (approved only): lookup service prices and sum
    Reservation.aggregate([
      { $match: { ...matchRange, status: RESERVATION_STATUS.APPROVED } },
      {
        $lookup: {
          from: 'services',
          localField: 'serviceId',
          foreignField: '_id',
          as: 'service',
        },
      },
      { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          amount: {
            $ifNull: [
              '$service.price',
              { $ifNull: ['$service.priceMin', 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$date',
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          amount: 1,
          count: 1,
        },
      },
    ]),
    // unique customers in range (non-canceled)
    Reservation.aggregate([
      { $match: { ...matchRange, status: { $ne: RESERVATION_STATUS.CANCELED } } },
      { $group: { _id: '$customerId' } },
    ]),
  ]);

  const totalAll = totals.reduce((acc, r) => acc + (r.count || 0), 0);
  const totalCanceled = totals.find((r) => r._id === RESERVATION_STATUS.CANCELED)?.count || 0;
  const cancelRate = totalAll > 0 ? totalCanceled / totalAll : 0;

  const busiestHour = hourAgg?.[0]?._id ? `${hourAgg[0]._id}:00` : null;

  const topStaff = staffAgg?.[0] || null;

  // New customers: first-ever reservation date in range (for this business)
  const uniqueCustomerIds = customersInRange.map((r) => r._id).filter(Boolean);
  const firstResByCustomer = await Reservation.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(businessId),
        status: { $ne: RESERVATION_STATUS.CANCELED },
        customerId: { $in: uniqueCustomerIds },
      },
    },
    { $group: { _id: '$customerId', firstDate: { $min: '$date' } } },
  ]);
  const newCustomers = firstResByCustomer.filter((r) => r.firstDate >= fromStored && r.firstDate < toEnd).length;

  // Returning rate: customers who had a reservation before range and also in range
  const returningCustomers = firstResByCustomer.filter((r) => r.firstDate < fromStored).length;
  const uniqueCustomersInRange = uniqueCustomerIds.length;
  const returningRate = uniqueCustomersInRange > 0 ? returningCustomers / uniqueCustomersInRange : 0;

  const currency = 'TRY';
  const daily = dailyAgg.map((d) => ({
    date: d.date,
    amount: Number(d.amount || 0),
    count: Number(d.count || 0),
  }));

  const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  const todayStored = reservationDayToStoredDate(todayKey);
  const todayRow = daily.find((d) => new Date(d.date).getTime() === todayStored.getTime());
  const dailyEarnings = todayRow ? todayRow.amount : 0;

  return success(
    res,
    200,
    {
      range: { from: fromYmd, to: toYmd },
      currency,
      kpis: {
        dailyEarnings,
        busiestHour,
        topStaff,
        cancelRate,
        newCustomers,
        returningRate,
        uniqueCustomersInRange,
      },
      charts: {
        dailyRevenue: daily.map((d) => ({
          date: d.date,
          amount: d.amount,
        })),
      },
    },
    'OK'
  );
});

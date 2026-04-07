const Reservation = require('../models/Reservation');
const Business = require('../models/Business');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { getAvailableSlots, timeToMinutes, minutesToTime } = require('../utils/slotCalculator');
const { reservationDayToStoredDate, nextReservationDayStoredDate } = require('../utils/calendarDate');
const { RESERVATION_STATUS } = require('../config/constants');
const { ROLES } = require('../config/constants');

/**
 * Calculate end time from start time and duration
 */
function calculateEndTime(timeStr, durationMinutes) {
  const start = timeToMinutes(timeStr);
  return minutesToTime(start + durationMinutes);
}

/**
 * POST /reservations - Create reservation (Customer or authenticated user)
 * Body: businessId, serviceId, staffId?, date, time, notes?
 * Subscription must be active for the business.
 */
exports.createReservation = asyncHandler(async (req, res) => {
  const { businessId, serviceId, staffId, date, time, notes } = req.body;
  const customerId = req.user._id;

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  const service = await Service.findOne({ _id: serviceId, businessId, isActive: true });
  if (!service) return error(res, 404, 'Service not found.');

  const durationMinutes = service.durationMinutes;
  const endTime = calculateEndTime(time, durationMinutes);

  const reservationDate = reservationDayToStoredDate(date);
  if (!reservationDate) return error(res, 400, 'Invalid date.');

  // Check for overlapping reservations (same business, same date, overlapping time)
  const nextDay = nextReservationDayStoredDate(reservationDate);
  const overlapQuery = {
    businessId,
    date: { $gte: reservationDate, $lt: nextDay },
    status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED] },
    time: { $lt: endTime },
    endTime: { $gt: time },
  };
  if (staffId) overlapQuery.staffId = staffId;

  const overlapping = await Reservation.findOne(overlapQuery);
  if (overlapping) {
    return error(res, 409, 'This time slot is already booked.');
  }

  const reservation = await Reservation.create({
    businessId,
    serviceId,
    staffId: staffId || null,
    customerId,
    date: reservationDate,
    time,
    durationMinutes,
    endTime,
    status: RESERVATION_STATUS.PENDING,
    notes: notes || undefined,
  });

  await reservation.populate([
    { path: 'businessId', select: 'name address phone' },
    { path: 'serviceId', select: 'name durationMinutes price' },
    { path: 'staffId', select: 'name title' },
  ]);
  return success(res, 201, reservation, 'Reservation created successfully.');
});

/**
 * GET /reservations/available-slots - Get available slots for a business, service, date, optional staff
 * Query: businessId, serviceId, date, staffId?
 */
exports.getAvailableSlots = asyncHandler(async (req, res) => {
  const { businessId, serviceId, date, staffId } = req.query;
  if (!businessId || !serviceId || !date) {
    return error(res, 400, 'businessId, serviceId and date are required.');
  }

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  const service = await Service.findOne({ _id: serviceId, businessId, isActive: true });
  if (!service) return error(res, 404, 'Service not found.');

  const reservationDate = reservationDayToStoredDate(date);
  if (!reservationDate) return error(res, 400, 'Invalid date.');
  const nextDay = nextReservationDayStoredDate(reservationDate);

  const existingQuery = {
    businessId,
    date: { $gte: reservationDate, $lt: nextDay },
    status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED] },
  };
  if (staffId) existingQuery.staffId = staffId;

  const existingReservations = await Reservation.find(existingQuery).lean();

  let staff = null;
  if (staffId) {
    staff = await Staff.findOne({ _id: staffId, businessId, isActive: true });
  }

  const slots = getAvailableSlots(
    business,
    service.durationMinutes,
    reservationDate,
    existingReservations,
    staff
  );

  return success(res, 200, { slots, date: reservationDate, service: { name: service.name, durationMinutes: service.durationMinutes } }, 'OK');
});

/**
 * GET /reservations/business/:businessId - List reservations for a business (owner)
 */
exports.getReservationsByBusiness = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const { status, dateFrom, dateTo } = req.query;

  const filter = { businessId };
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) {
      const from = reservationDayToStoredDate(dateFrom);
      if (!from) return error(res, 400, 'Invalid dateFrom.');
      filter.date.$gte = from;
    }
    if (dateTo) {
      const to = reservationDayToStoredDate(dateTo);
      if (!to) return error(res, 400, 'Invalid dateTo.');
      filter.date.$lte = to;
    }
  }

  const reservations = await Reservation.find(filter)
    .populate('serviceId', 'name durationMinutes price')
    .populate('staffId', 'name title')
    .populate('customerId', 'firstName lastName email phone')
    .sort({ date: 1, time: 1 })
    .lean();
  return success(res, 200, reservations, 'OK');
});

/**
 * GET /reservations/customer/:customerId - List reservations for a customer (self or admin)
 */
exports.getReservationsByCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user._id.toString() !== customerId) {
    return error(res, 403, 'You can only view your own reservations.');
  }

  const filter = { customerId };
  const { status } = req.query;
  if (status) filter.status = status;

  const reservations = await Reservation.find(filter)
    .populate('businessId', 'name address phone businessType')
    .populate('serviceId', 'name durationMinutes price')
    .populate('staffId', 'name title')
    .sort({ date: -1, time: -1 })
    .lean();
  return success(res, 200, reservations, 'OK');
});

/**
 * PATCH /reservations/:id/status - Approve or cancel (business owner)
 * Body: status (approved | canceled)
 */
exports.updateReservationStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const reservation = await Reservation.findById(id);
  if (!reservation) return error(res, 404, 'Reservation not found.');

  const business = await Business.findById(reservation.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  if (status === RESERVATION_STATUS.APPROVED) {
    if (reservation.status !== RESERVATION_STATUS.PENDING) {
      return error(res, 400, 'Only pending reservations can be approved.');
    }
    reservation.status = RESERVATION_STATUS.APPROVED;
  } else if (status === RESERVATION_STATUS.CANCELED) {
    if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
      return error(res, 400, 'Reservation cannot be canceled.');
    }
    reservation.status = RESERVATION_STATUS.CANCELED;
    reservation.canceledAt = new Date();
    reservation.canceledBy = req.user._id;
  } else {
    return error(res, 400, 'Invalid status. Use approved or canceled.');
  }

  await reservation.save();
  await reservation.populate([
    { path: 'serviceId', select: 'name durationMinutes' },
    { path: 'customerId', select: 'firstName lastName email' },
  ]);
  return success(res, 200, reservation, 'Reservation updated.');
});

/**
 * DELETE /reservations/:id - Cancel reservation (customer cancels own)
 */
exports.cancelReservation = asyncHandler(async (req, res) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return error(res, 404, 'Reservation not found.');

  const isOwner = reservation.customerId.toString() === req.user._id.toString();
  const business = await Business.findById(reservation.businessId);
  const isBusinessOwner = business && business.ownerId.toString() === req.user._id.toString();

  if (!isOwner && !isBusinessOwner && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'You can only cancel your own reservations.');
  }

  if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
    return error(res, 400, 'Reservation cannot be canceled.');
  }

  reservation.status = RESERVATION_STATUS.CANCELED;
  reservation.canceledAt = new Date();
  reservation.canceledBy = req.user._id;
  await reservation.save();

  return success(res, 200, reservation, 'Reservation canceled successfully.');
});

/**
 * GET /reservations/:id - Get single reservation
 */
exports.getReservation = asyncHandler(async (req, res) => {
  const reservation = await Reservation.findById(req.params.id)
    .populate('businessId', 'name address phone')
    .populate('serviceId', 'name durationMinutes price')
    .populate('staffId', 'name title')
    .populate('customerId', 'firstName lastName email phone');
  if (!reservation) return error(res, 404, 'Reservation not found.');

  const custId = (reservation.customerId?._id || reservation.customerId)?.toString();
  const isCustomer = custId === req.user._id.toString();
  const business = await Business.findById(reservation.businessId);
  const isOwner = business && business.ownerId.toString() === req.user._id.toString();
  if (!isCustomer && !isOwner && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'You do not have access to this reservation.');
  }

  return success(res, 200, reservation, 'OK');
});

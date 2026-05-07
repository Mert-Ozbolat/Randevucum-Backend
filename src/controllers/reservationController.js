const Reservation = require('../models/Reservation');
const Business = require('../models/Business');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const User = require('../models/User');
const { normalizeE164Tr } = require('../services/whatsapp');
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
 * Hizmette staffIds doluysa yalnızca bu listedeki aktif personel;
 * boşsa personelin serviceIds kuralları (boş = tüm hizmetler).
 */
function isStaffEligibleForService(staffDoc, serviceDoc) {
  const sid = serviceDoc._id.toString();
  const assigned = serviceDoc.staffIds;
  if (assigned && assigned.length > 0) {
    return assigned.some((id) => id.toString() === staffDoc._id.toString());
  }
  const services = staffDoc.serviceIds || [];
  if (services.length === 0) return true;
  return services.some((id) => id.toString() === sid);
}

async function getEligibleStaffCount(businessId, serviceDoc) {
  const list = await Staff.find({ businessId, isActive: true }).select('serviceIds').lean();
  const eligible = list.filter((s) => isStaffEligibleForService({ ...s, _id: s._id }, serviceDoc));
  return Math.max(1, eligible.length);
}

/**
 * POST /reservations - Create reservation (Customer or authenticated user)
 * Body: businessId, serviceId, staffId?, date, time, notes?
 * Subscription must be active for the business.
 */
exports.createReservation = asyncHandler(async (req, res) => {
  const { businessId, serviceId, staffId, date, time, notes, customerPhone } = req.body;
  const customerId = req.user._id;

  // First reservation: capture phone if user profile has none yet.
  if ((!req.user.phone || !String(req.user.phone).trim()) && customerPhone) {
    const phone = String(customerPhone).trim();
    const e164 = normalizeE164Tr(phone);
    if (e164) {
      await User.updateOne({ _id: customerId }, { $set: { phone: e164 } });
      // keep req.user in sync for this request's downstream usage
      req.user.phone = e164;
    } else {
      return error(res, 400, 'Telefon numarası geçersiz.');
    }
  }

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  const service = await Service.findOne({ _id: serviceId, businessId, isActive: true });
  if (!service) return error(res, 404, 'Service not found.');

  const durationMinutes = service.durationMinutes;
  const endTime = calculateEndTime(time, durationMinutes);

  const reservationDate = reservationDayToStoredDate(date);
  if (!reservationDate) return error(res, 400, 'Invalid date.');

  const capacity = await getEligibleStaffCount(businessId, service);

  const nextDay = nextReservationDayStoredDate(reservationDate);
  const overlapQuery = {
    businessId,
    date: { $gte: reservationDate, $lt: nextDay },
    status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED] },
    time: { $lt: endTime },
    endTime: { $gt: time },
  };

  const overlapping = await Reservation.find(overlapQuery).lean();
  if (overlapping.length >= capacity) {
    return error(res, 409, 'This time slot is fully booked.');
  }

  let resolvedStaffId = staffId || null;
  if (resolvedStaffId) {
    const staffMember = await Staff.findOne({
      _id: resolvedStaffId,
      businessId,
      isActive: true,
    });
    if (!staffMember) return error(res, 400, 'Invalid staff member.');
    if (!isStaffEligibleForService(staffMember, service)) {
      return error(res, 400, 'This staff member does not offer this service.');
    }
    const taken = overlapping.some(
      (r) => r.staffId && r.staffId.toString() === resolvedStaffId.toString()
    );
    if (taken) {
      return error(res, 409, 'This staff member is already booked at this time.');
    }
  }

  const reservation = await Reservation.create({
    businessId,
    serviceId,
    staffId: resolvedStaffId,
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
    { path: 'serviceId', select: 'name durationMinutes price priceMin priceMax currency' },
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

  const existingReservations = await Reservation.find(existingQuery).lean();

  let staff = null;
  if (staffId) {
    staff = await Staff.findOne({ _id: staffId, businessId, isActive: true });
    if (!staff) return error(res, 404, 'Staff not found.');
    if (!isStaffEligibleForService(staff, service)) {
      return error(res, 400, 'This staff member does not offer this service.');
    }
  }

  const capacity = await getEligibleStaffCount(businessId, service);

  const slots = getAvailableSlots(
    business,
    service.durationMinutes,
    reservationDate,
    existingReservations,
    staff,
    { capacity, selectedStaffId: staffId || null }
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
    .populate('serviceId', 'name durationMinutes price priceMin priceMax currency')
    .populate('staffId', 'name title')
    .populate('customerId', 'firstName lastName email phone')
    .sort({ date: 1, time: 1 })
    .lean();
  return success(res, 200, reservations, 'OK');
});

/**
 * GET /reservations/staff/mine — Personelin kendi atandığı randevular (yetki + hesap eşleşmesi gerekir)
 */
exports.getMyStaffReservations = asyncHandler(async (req, res) => {
  const staffRows = await Staff.find({
    userId: req.user._id,
    isActive: true,
    canViewOwnReservations: true,
  }).lean();

  if (!staffRows.length) {
    return error(
      res,
      403,
      'Randevuları görüntüleme yetkisi yok veya hesabınız personel kaydıyla eşleştirilmemiş.'
    );
  }

  const staffIds = staffRows.map((s) => s._id);
  const { status, dateFrom, dateTo } = req.query;

  const filter = { staffId: { $in: staffIds } };
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
    .populate('businessId', 'name address phone businessType')
    .populate('serviceId', 'name durationMinutes price priceMin priceMax currency')
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
    .populate('serviceId', 'name durationMinutes price priceMin priceMax currency')
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
    { path: 'serviceId', select: 'name durationMinutes price priceMin priceMax currency' },
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

  const staffRows = await Staff.find({
    userId: req.user._id,
    isActive: true,
    canViewOwnReservations: true,
  })
    .select('_id')
    .lean();
  const allowedStaffIds = new Set(staffRows.map((s) => s._id.toString()));
  const resStaffId = (reservation.staffId?._id || reservation.staffId)?.toString();
  const isAssignedStaff = Boolean(resStaffId && allowedStaffIds.has(resStaffId));

  if (
    !isCustomer &&
    !isOwner &&
    req.user.role !== ROLES.SUPER_ADMIN &&
    !isAssignedStaff
  ) {
    return error(res, 403, 'You do not have access to this reservation.');
  }

  return success(res, 200, reservation, 'OK');
});

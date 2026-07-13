const Reservation = require('../models/Reservation');
const Business = require('../models/Business');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const User = require('../models/User');
const { normalizePhoneForDatabase } = require('../utils/phone');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { getAvailableSlots, normalizeTimeStr, findOverlappingReservations, getStaffConcurrentLimit, timeToMinutes, minutesToTime } = require('../utils/slotCalculator');
const { reservationDayToStoredDate, nextReservationDayStoredDate } = require('../utils/calendarDate');
const { RESERVATION_STATUS } = require('../config/constants');
const { ROLES } = require('../config/constants');
const { ATTENDANCE_OUTCOME } = require('../config/constants');
const { sendReservationBookingWhatsApp } = require('../services/whatsappReservationNotify');
const { sendNoShowWarningWhatsApp } = require('../services/attendanceNotify');
const { findOrCreateQuickBookingUser } = require('../utils/quickBookingUser');
const jwt = require('jsonwebtoken');
const {
  isReservationPastEnd,
  updateCustomerAttendanceStats,
} = require('../utils/attendanceService');
const { waLog } = require('../utils/whatsappLog');
const { getSlotCapacity } = require('../utils/bookingCapacity');
const { getReservationQuota } = require('../utils/subscriptionLimits');
const {
  canCustomerCancelReservation,
  CUSTOMER_CANCEL_HOURS_BEFORE,
} = require('../utils/reservationCancelPolicy');
const {
  isBusinessClosedOnDate,
  getBusinessClosedReason,
  isStaffOnLeave,
  getStaffLeaveReason,
  exceptionDayKey,
  eachCalendarDayKeys,
  expandExceptionToDayKeys,
} = require('../utils/availabilityExceptions');
const { userCanManageBusinessReservations } = require('../middleware/ownership');

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

async function getEligibleStaffForService(businessId, serviceDoc, reservationDate = null) {
  const list = await Staff.find({ businessId, isActive: true }).lean();
  return list.filter((s) => {
    if (!isStaffEligibleForService(s, serviceDoc)) return false;
    if (reservationDate && isStaffOnLeave(s, reservationDate)) return false;
    return true;
  });
}

async function getEligibleStaffCount(businessId, serviceDoc, reservationDate = null) {
  const eligible = await getEligibleStaffForService(businessId, serviceDoc, reservationDate);
  if (eligible.length > 0) return eligible.length;
  const hasAnyStaff = await Staff.exists({ businessId, isActive: true });
  if (!hasAnyStaff) return 1;
  return 0;
}

function signQuickBookingToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: 'HS256',
  });
}

/**
 * Ortak randevu oluşturma — müşteri kimliği çözüldükten sonra doğrulama + kayıt.
 */
async function createReservationCore({
  businessId,
  serviceId,
  staffId,
  date,
  time,
  notes,
  customerId,
  customerPhoneHint,
}) {
  const business = await Business.findById(businessId);
  if (!business) return { error: { status: 404, message: 'Business not found.' } };
  if (business.billingSuspended) {
    return {
      error: {
        status: 403,
        message:
          'Bu işletmenin aboneliği askıda. Yeni randevu alınamaz; işletme sahibi aboneliğini yenilemelidir.',
      },
    };
  }
  if (!business.isActive) {
    return { error: { status: 403, message: 'Bu işletme henüz randevu almaya açık değil.' } };
  }

  const service = await Service.findOne({ _id: serviceId, businessId, isActive: true });
  if (!service) return { error: { status: 404, message: 'Service not found.' } };

  const durationMinutes = service.durationMinutes;
  const normalizedTime = normalizeTimeStr(time);
  const endTime = calculateEndTime(normalizedTime, durationMinutes);

  const reservationDate = reservationDayToStoredDate(date);
  if (!reservationDate) return { error: { status: 400, message: 'Invalid date.' } };

  if (isBusinessClosedOnDate(business, reservationDate)) {
    return {
      error: {
        status: 403,
        message: getBusinessClosedReason(business, reservationDate) || 'Bu tarihte işletme kapalı.',
      },
    };
  }

  const eligibleStaffCount = await getEligibleStaffCount(businessId, service, reservationDate);
  if (eligibleStaffCount === 0) {
    return { error: { status: 403, message: 'Bu tarihte müsait personel yok.' } };
  }
  const capacity = getSlotCapacity(business, eligibleStaffCount);

  const nextDay = nextReservationDayStoredDate(reservationDate);
  const dayReservations = await Reservation.find({
    businessId,
    date: { $gte: reservationDate, $lt: nextDay },
    status: { $in: [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED] },
  }).lean();

  const overlapping = findOverlappingReservations(dayReservations, normalizedTime, durationMinutes);
  if (overlapping.length >= capacity) {
    return { error: { status: 409, message: 'Bu saat dilimi dolu.' } };
  }

  let resolvedStaffId = staffId || null;
  if (resolvedStaffId) {
    const staffMember = await Staff.findOne({
      _id: resolvedStaffId,
      businessId,
      isActive: true,
    });
    if (!staffMember) return { error: { status: 400, message: 'Invalid staff member.' } };
    if (!isStaffEligibleForService(staffMember, service)) {
      return { error: { status: 400, message: 'This staff member does not offer this service.' } };
    }
    if (isStaffOnLeave(staffMember, reservationDate)) {
      return {
        error: {
          status: 403,
          message: getStaffLeaveReason(staffMember, reservationDate) || 'Seçilen personel bu tarihte izinli.',
        },
      };
    }
    const staffCap = getStaffConcurrentLimit(business, staffMember);
    const staffOverlapping = overlapping.filter(
      (r) => r.staffId && r.staffId.toString() === resolvedStaffId.toString()
    );
    if (staffOverlapping.length >= staffCap) {
      return { error: { status: 409, message: 'Seçilen personel bu saat diliminde dolu.' } };
    }
  }

  const reservationQuota = await getReservationQuota(businessId);
  if (!reservationQuota.canAccept) {
    return {
      error: {
        status: 403,
        message: `Bu işletme standart paket aylık randevu limitine ulaştı (${reservationQuota.limit}/ay). PRO pakete geçilerek sınırsız randevu alınabilir.`,
      },
    };
  }

  const reservation = await Reservation.create({
    businessId,
    serviceId,
    staffId: resolvedStaffId,
    customerId,
    date: reservationDate,
    time: normalizedTime,
    durationMinutes,
    endTime,
    status: RESERVATION_STATUS.APPROVED,
    notes: notes || undefined,
  });

  await reservation.populate([
    { path: 'businessId', select: 'name address phone ownerId' },
    { path: 'serviceId', select: 'name durationMinutes price priceMin priceMax currency' },
    { path: 'staffId', select: 'name title' },
    { path: 'customerId', select: 'firstName lastName email phone attendanceStats' },
  ]);

  waLog('🔔', 'Randevu oluşturuldu — anlık WhatsApp tetikleniyor', {
    reservationId: String(reservation._id),
    businessId: String(businessId),
  });
  void sendReservationBookingWhatsApp(reservation._id, {
    customerPhoneHint: customerPhoneHint || undefined,
  }).catch((err) =>
    waLog('💥', 'Anlık WhatsApp beklenmeyen hata', { message: err?.message || String(err) })
  );

  return { reservation };
}

/**
 * POST /reservations - Create reservation (Customer or authenticated user)
 * Body: businessId, serviceId, staffId?, date, time, notes?
 * Subscription must be active for the business.
 */
exports.createReservation = asyncHandler(async (req, res) => {
  const { businessId, serviceId, staffId, date, time, notes, customerPhone, guestName } = req.body;

  let customerId;
  let quickBooking = false;
  let quickBookingUser = null;

  if (req.user) {
    customerId = req.user._id;

    const userHasPhone = Boolean(req.user.phone && String(req.user.phone).trim());
    if (!userHasPhone && !customerPhone) {
      return error(res, 400, 'Telefon numarası gerekli.');
    }

    if (!userHasPhone && customerPhone) {
      const phone = String(customerPhone).trim();
      const e164 = normalizePhoneForDatabase(phone);
      if (e164) {
        await User.updateOne({ _id: customerId }, { $set: { phone: e164 } });
        req.user.phone = e164;
      } else {
        return error(res, 400, 'Telefon numarası geçersiz.');
      }
    }
  } else {
    if (!guestName || !String(guestName).trim()) {
      return error(res, 400, 'Ad soyad gerekli.');
    }
    if (!customerPhone || !String(customerPhone).trim()) {
      return error(res, 400, 'WhatsApp telefon numarası gerekli.');
    }

    const quickResult = await findOrCreateQuickBookingUser({
      guestName: String(guestName).trim(),
      customerPhone: String(customerPhone).trim(),
    });
    if (!quickResult.ok) {
      return error(res, 400, 'Telefon numarası geçersiz.');
    }

    quickBooking = true;
    quickBookingUser = quickResult.user;
    customerId = quickResult.user._id;
    req.user = quickResult.user;
  }

  const customerPhoneForWa =
    req.user?.phone && String(req.user.phone).trim() ? String(req.user.phone).trim() : undefined;

  const result = await createReservationCore({
    businessId,
    serviceId,
    staffId,
    date,
    time,
    notes,
    customerId,
    customerPhoneHint: customerPhoneForWa,
  });

  if (result.error) {
    return error(res, result.error.status, result.error.message);
  }

  const payload = { reservation: result.reservation };
  if (quickBooking && quickBookingUser) {
    const userObj = quickBookingUser.toObject ? quickBookingUser.toObject() : { ...quickBookingUser };
    delete userObj.password;
    payload.quickBooking = true;
    payload.token = signQuickBookingToken(quickBookingUser._id);
    payload.user = userObj;
  }

  return success(res, 201, payload, 'Reservation created successfully.');
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

  if (isBusinessClosedOnDate(business, reservationDate)) {
    return success(
      res,
      200,
      {
        slots: [],
        date: reservationDate,
        closed: true,
        reason: getBusinessClosedReason(business, reservationDate),
      },
      'OK'
    );
  }

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
    if (isStaffOnLeave(staff, reservationDate)) {
      return success(
        res,
        200,
        {
          slots: [],
          date: reservationDate,
          staffOnLeave: true,
          reason: getStaffLeaveReason(staff, reservationDate),
        },
        'OK'
      );
    }
  }

  const eligibleStaffCount = await getEligibleStaffCount(businessId, service, reservationDate);
  if (eligibleStaffCount === 0) {
    return success(
      res,
      200,
      { slots: [], date: reservationDate, noStaffAvailable: true },
      'OK'
    );
  }
  const capacity = getSlotCapacity(business, eligibleStaffCount);
  const staffConcurrentLimit = staff ? getStaffConcurrentLimit(business, staff) : null;

  const slots = getAvailableSlots(
    business,
    service.durationMinutes,
    reservationDate,
    existingReservations,
    staff,
    { capacity, selectedStaffId: staffId || null, staffConcurrentLimit }
  );

  return success(res, 200, { slots, date: reservationDate, service: { name: service.name, durationMinutes: service.durationMinutes } }, 'OK');
});

/**
 * GET /reservations/blocked-dates — Takvimde seçilemeyecek günler (işletme kapalı + personel izin)
 * Query: businessId, serviceId, staffId?, from?, to? (yyyy-MM-dd)
 */
exports.getBlockedDates = asyncHandler(async (req, res) => {
  const { businessId, serviceId, staffId } = req.query;
  if (!businessId || !serviceId) {
    return error(res, 400, 'businessId and serviceId are required.');
  }

  const business = await Business.findById(businessId).select('closedDays').lean();
  if (!business) return error(res, 404, 'Business not found.');
  const service = await Service.findOne({ _id: serviceId, businessId, isActive: true }).lean();
  if (!service) return error(res, 404, 'Service not found.');

  const today = new Date();
  const defaultFrom = reservationDayToStoredDate(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  );
  const defaultTo = reservationDayToStoredDate(
    (() => {
      const end = new Date(today);
      end.setDate(end.getDate() + 60);
      return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    })()
  );

  const fromStored = reservationDayToStoredDate(req.query.from) || defaultFrom;
  const toStored = reservationDayToStoredDate(req.query.to) || defaultTo;
  if (!fromStored || !toStored || fromStored.getTime() > toStored.getTime()) {
    return error(res, 400, 'Invalid from/to date range.');
  }

  const dayKeys = eachCalendarDayKeys(fromStored, toStored);
  const businessClosedSet = new Set();
  for (const entry of business.closedDays || []) {
    for (const key of expandExceptionToDayKeys(entry)) {
      businessClosedSet.add(key);
    }
  }

  let staffLeaveSet = new Set();
  if (staffId) {
    const staff = await Staff.findOne({ _id: staffId, businessId, isActive: true })
      .select('leaveDays serviceIds')
      .lean();
    if (!staff) return error(res, 404, 'Staff not found.');
    if (!isStaffEligibleForService(staff, service)) {
      return error(res, 400, 'This staff member does not offer this service.');
    }
    for (const entry of staff.leaveDays || []) {
      for (const key of expandExceptionToDayKeys(entry)) {
        staffLeaveSet.add(key);
      }
    }
  } else {
    const eligibleStaff = await getEligibleStaffForService(businessId, service);
    for (const member of eligibleStaff) {
      for (const entry of member.leaveDays || []) {
        for (const key of expandExceptionToDayKeys(entry)) {
          staffLeaveSet.add(key);
        }
      }
    }
  }

  const unavailable = [];

  for (const key of dayKeys) {
    const stored = reservationDayToStoredDate(key);
    if (!stored) continue;
    if (businessClosedSet.has(key)) {
      unavailable.push(key);
      continue;
    }
    if (staffId) {
      if (staffLeaveSet.has(key)) unavailable.push(key);
      continue;
    }
    const count = await getEligibleStaffCount(businessId, service, stored);
    if (count === 0) unavailable.push(key);
  }

  return success(
    res,
    200,
    {
      unavailable,
      businessClosed: [...businessClosedSet].filter((k) => dayKeys.includes(k)),
      staffLeave: [...staffLeaveSet].filter((k) => dayKeys.includes(k)),
      from: exceptionDayKey(fromStored),
      to: exceptionDayKey(toStored),
    },
    'OK'
  );
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
    .populate('customerId', 'firstName lastName email phone attendanceStats')
    .sort({ date: 1, time: 1 })
    .lean();
  return success(res, 200, reservations, 'OK');
});

/**
 * GET /reservations/business/:businessId/customers/search?q=
 * Daha önce bu işletmeden randevu almış müşterileri ara.
 */
exports.searchBusinessCustomers = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return success(res, 200, [], 'OK');
  }

  const customerIds = await Reservation.distinct('customerId', { businessId });
  if (!customerIds.length) {
    return success(res, 200, [], 'OK');
  }

  const phoneDigits = q.replace(/\D/g, '');
  const parts = q.split(/\s+/).filter(Boolean);
  const orConditions = [];

  if (phoneDigits.length >= 3) {
    orConditions.push({ phone: { $regex: phoneDigits.slice(-10) } });
  }

  if (parts.length === 1) {
    orConditions.push({ firstName: { $regex: parts[0], $options: 'i' } });
    orConditions.push({ lastName: { $regex: parts[0], $options: 'i' } });
  } else if (parts.length >= 2) {
    orConditions.push({
      $and: [
        { firstName: { $regex: parts[0], $options: 'i' } },
        { lastName: { $regex: parts.slice(1).join(' '), $options: 'i' } },
      ],
    });
  }

  const filter = {
    _id: { $in: customerIds },
    role: ROLES.CUSTOMER,
  };
  if (orConditions.length) {
    filter.$or = orConditions;
  } else {
    filter.$or = [
      { firstName: { $regex: q, $options: 'i' } },
      { lastName: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
    ];
  }

  const users = await User.find(filter)
    .select('firstName lastName email phone')
    .sort({ lastName: 1, firstName: 1 })
    .limit(20)
    .lean();

  return success(res, 200, users, 'OK');
});

/**
 * POST /reservations/business/:businessId/manual
 * İşletme sahibi veya yetkili personel manuel randevu oluşturur.
 */
exports.createManualReservation = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const { serviceId, staffId, date, time, notes, customerId, guestName, customerPhone } = req.body;

  let resolvedCustomerId;
  let customerPhoneHint;

  if (customerId) {
    const hadBooking = await Reservation.exists({ businessId, customerId });
    if (!hadBooking) {
      return error(res, 400, 'Bu müşteri bu işletmeden daha önce randevu almamış.');
    }
    const user = await User.findById(customerId).select('_id role phone firstName lastName');
    if (!user || user.role !== ROLES.CUSTOMER) {
      return error(res, 400, 'Geçersiz müşteri.');
    }
    resolvedCustomerId = user._id;
    customerPhoneHint = user.phone ? String(user.phone).trim() : undefined;
  } else {
    const quickResult = await findOrCreateQuickBookingUser({
      guestName: String(guestName).trim(),
      customerPhone: String(customerPhone).trim(),
    });
    if (!quickResult.ok) {
      return error(res, 400, 'Telefon numarası geçersiz.');
    }
    resolvedCustomerId = quickResult.user._id;
    customerPhoneHint = quickResult.user.phone ? String(quickResult.user.phone).trim() : undefined;
  }

  const result = await createReservationCore({
    businessId,
    serviceId,
    staffId,
    date,
    time,
    notes,
    customerId: resolvedCustomerId,
    customerPhoneHint,
  });

  if (result.error) {
    return error(res, result.error.status, result.error.message);
  }

  return success(res, 201, { reservation: result.reservation }, 'Manuel randevu oluşturuldu.');
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
 * PATCH /reservations/:id/status - Cancel reservation (business owner)
 * Body: status (canceled)
 */
exports.updateReservationStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const reservation = await Reservation.findById(id);
  if (!reservation) return error(res, 404, 'Reservation not found.');

  const manageAccess = await userCanManageBusinessReservations(req.user, reservation.businessId);
  if (!manageAccess && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'You do not own this business.');
  }

  if (status !== RESERVATION_STATUS.CANCELED) {
    return error(res, 400, 'Yalnızca iptal işlemi desteklenir.');
  }

  if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
    return error(res, 400, 'Reservation cannot be canceled.');
  }

  reservation.status = RESERVATION_STATUS.CANCELED;
  reservation.canceledAt = new Date();
  reservation.canceledBy = req.user._id;

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
  const manageAccess = await userCanManageBusinessReservations(req.user, reservation.businessId);
  const isBusinessManager = Boolean(manageAccess);

  if (!isOwner && !isBusinessManager && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'You can only cancel your own reservations.');
  }

  if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
    return error(res, 400, 'Reservation cannot be canceled.');
  }

  if (isOwner && !isBusinessManager && req.user.role !== ROLES.SUPER_ADMIN) {
    if (!canCustomerCancelReservation(reservation)) {
      return error(
        res,
        403,
        `Randevu başlangıcına ${CUSTOMER_CANCEL_HOURS_BEFORE} saatten az kaldığı için iptal edilemez.`
      );
    }
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

/**
 * PATCH /reservations/:id/attendance — İşletme: randevuya gelme durumunu işaretle
 * Body: { outcome: 'attended' | 'no_show', note? }
 */
exports.markReservationAttendance = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { outcome, note } = req.body;

  if (![ATTENDANCE_OUTCOME.ATTENDED, ATTENDANCE_OUTCOME.NO_SHOW].includes(outcome)) {
    return error(res, 400, 'Geçersiz katılım durumu.');
  }

  const reservation = await Reservation.findById(id);
  if (!reservation) return error(res, 404, 'Reservation not found.');

  const business = await Business.findById(reservation.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  if (reservation.status === RESERVATION_STATUS.CANCELED) {
    return error(res, 400, 'İptal edilmiş randevu için katılım işaretlenemez.');
  }

  if (!isReservationPastEnd(reservation)) {
    return error(res, 400, 'Randevu henüz bitmedi. Katılım işaretlemesi randevu saati geçtikten sonra yapılabilir.');
  }

  const previousOutcome = reservation.attendance?.outcome || null;

  reservation.attendance = {
    outcome,
    markedAt: new Date(),
    markedBy: req.user._id,
    note: note ? String(note).trim().slice(0, 500) : '',
  };

  reservation.status =
    outcome === ATTENDANCE_OUTCOME.NO_SHOW
      ? RESERVATION_STATUS.NO_SHOW
      : RESERVATION_STATUS.COMPLETED;

  await reservation.save();

  const updatedStats = await updateCustomerAttendanceStats(
    reservation.customerId,
    previousOutcome,
    outcome
  );

  if (outcome === ATTENDANCE_OUTCOME.NO_SHOW && previousOutcome !== ATTENDANCE_OUTCOME.NO_SHOW) {
    sendNoShowWarningWhatsApp(reservation._id).catch(() => {});
  }

  await reservation.populate([
    { path: 'serviceId', select: 'name durationMinutes price priceMin priceMax currency' },
    { path: 'staffId', select: 'name title' },
    { path: 'customerId', select: 'firstName lastName email phone attendanceStats' },
  ]);

  const result = reservation.toObject ? reservation.toObject() : reservation;
  if (result.customerId && updatedStats) {
    result.customerId.attendanceStats = updatedStats;
  }

  return success(res, 200, result, 'Katılım durumu kaydedildi.');
});

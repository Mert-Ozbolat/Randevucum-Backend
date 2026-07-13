const express = require('express');
const reservationController = require('../controllers/reservationController');
const { protect, optionalAuth } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');
const { requireBusinessOwnership, requireBusinessManageAccess } = require('../middleware/ownership');
const {
  createReservationRules,
  updateStatusRules,
  markAttendanceRules,
  availableSlotsQueryRules,
  blockedDatesQueryRules,
  reservationIdParamRules,
  businessIdParamRules,
  customerIdParamRules,
  searchBusinessCustomersQueryRules,
  createManualReservationRules,
  validate,
} = require('../validators/reservationValidator');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Get available slots (no auth required for viewing)
router.get(
  '/available-slots',
  availableSlotsQueryRules(),
  validate,
  reservationController.getAvailableSlots
);

router.get(
  '/blocked-dates',
  blockedDatesQueryRules(),
  validate,
  reservationController.getBlockedDates
);

// Customer creates reservation - business must have active subscription
const setBusinessIdFromBody = (req, res, next) => {
  if (req.body.businessId) req.businessId = req.body.businessId;
  next();
};

router.post(
  '/',
  optionalAuth,
  setBusinessIdFromBody,
  requireActiveSubscription,
  createReservationRules(),
  validate,
  reservationController.createReservation
);

// Business owner: list reservations for their business
router.get(
  '/business/:businessId',
  protect,
  businessIdParamRules(),
  validate,
  requireBusinessOwnership,
  reservationController.getReservationsByBusiness
);

// İşletme sahibi / yetkili personel: müşteri ara (daha önce randevu almış)
router.get(
  '/business/:businessId/customers/search',
  protect,
  searchBusinessCustomersQueryRules(),
  validate,
  requireBusinessManageAccess,
  reservationController.searchBusinessCustomers
);

// İşletme sahibi / yetkili personel: manuel randevu oluştur
router.post(
  '/business/:businessId/manual',
  protect,
  setBusinessIdFromBody,
  requireActiveSubscription,
  createManualReservationRules(),
  validate,
  requireBusinessManageAccess,
  reservationController.createManualReservation
);

// Staff (linked user): own assigned reservations
router.get('/staff/mine', protect, reservationController.getMyStaffReservations);

// Customer: list own reservations (or admin)
router.get(
  '/customer/:customerId',
  protect,
  customerIdParamRules(),
  validate,
  reservationController.getReservationsByCustomer
);

// Get single reservation
router.get(
  '/:id',
  protect,
  reservationIdParamRules(),
  validate,
  reservationController.getReservation
);

// Business owner: approve or cancel reservation
router.patch(
  '/:id/status',
  protect,
  updateStatusRules(),
  validate,
  reservationController.updateReservationStatus
);

// Business owner: mark attendance (attended / no_show)
router.patch(
  '/:id/attendance',
  protect,
  markAttendanceRules(),
  validate,
  reservationController.markReservationAttendance
);

// Customer or owner: cancel reservation
router.delete(
  '/:id',
  protect,
  reservationIdParamRules(),
  validate,
  reservationController.cancelReservation
);

module.exports = router;

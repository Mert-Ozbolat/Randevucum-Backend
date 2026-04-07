const express = require('express');
const reservationController = require('../controllers/reservationController');
const { protect } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');
const { requireBusinessOwnership } = require('../middleware/ownership');
const {
  createReservationRules,
  updateStatusRules,
  availableSlotsQueryRules,
  reservationIdParamRules,
  businessIdParamRules,
  customerIdParamRules,
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

// Customer creates reservation - business must have active subscription
const setBusinessIdFromBody = (req, res, next) => {
  if (req.body.businessId) req.businessId = req.body.businessId;
  next();
};

router.post(
  '/',
  protect,
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

// Customer or owner: cancel reservation
router.delete(
  '/:id',
  protect,
  reservationIdParamRules(),
  validate,
  reservationController.cancelReservation
);

module.exports = router;

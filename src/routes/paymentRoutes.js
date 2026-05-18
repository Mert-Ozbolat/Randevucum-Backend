const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const stripeController = require('../controllers/stripeController');

const router = express.Router();

router.get(
  '/stripe/config',
  protect,
  restrictTo(ROLES.BUSINESS_OWNER, ROLES.SUPER_ADMIN),
  stripeController.getStripeConfig
);

router.post(
  '/stripe/checkout-session',
  protect,
  restrictTo(ROLES.BUSINESS_OWNER, ROLES.SUPER_ADMIN),
  stripeController.createCheckoutSession
);

router.post(
  '/stripe/billing-portal',
  protect,
  restrictTo(ROLES.BUSINESS_OWNER, ROLES.SUPER_ADMIN),
  stripeController.createBillingPortalSession
);

module.exports = router;

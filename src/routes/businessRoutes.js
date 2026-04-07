const express = require('express');
const businessController = require('../controllers/businessController');
const { protect, restrictTo, optionalAuth } = require('../middleware/auth');
const { requireBusinessOwnership } = require('../middleware/ownership');
const {
  createBusinessRules,
  updateBusinessRules,
  getBusinessRules,
  validate,
} = require('../validators/businessValidator');
const { ROLES } = require('../config/constants');

const router = express.Router();

router.post(
  '/',
  protect,
  restrictTo(ROLES.SUPER_ADMIN, ROLES.BUSINESS_OWNER),
  createBusinessRules(),
  validate,
  businessController.createBusiness
);

router.put(
  '/:id',
  protect,
  restrictTo(ROLES.SUPER_ADMIN, ROLES.BUSINESS_OWNER),
  updateBusinessRules(),
  validate,
  requireBusinessOwnership,
  businessController.updateBusiness
);

router.get(
  '/:id',
  getBusinessRules(),
  validate,
  businessController.getBusiness
);

router.get(
  '/',
  optionalAuth,
  businessController.listBusinesses
);

module.exports = router;

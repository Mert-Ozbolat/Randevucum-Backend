const express = require('express');
const staffController = require('../controllers/staffController');
const { protect, optionalAuth } = require('../middleware/auth');
const {
  createStaffRules,
  updateStaffRules,
  updateMyStaffPhoneRules,
  businessIdParamRules,
  validate,
} = require('../validators/staffValidator');

const router = express.Router();

router.get('/me', protect, staffController.getMyStaffProfile);

router.patch(
  '/me/phone',
  protect,
  updateMyStaffPhoneRules(),
  validate,
  staffController.updateMyStaffPhone
);

router.post(
  '/',
  protect,
  createStaffRules(),
  validate,
  staffController.createStaff
);

router.put(
  '/:id',
  protect,
  updateStaffRules(),
  validate,
  staffController.updateStaff
);

router.get(
  '/business/:businessId',
  optionalAuth,
  businessIdParamRules(),
  validate,
  staffController.getStaffByBusiness
);

module.exports = router;

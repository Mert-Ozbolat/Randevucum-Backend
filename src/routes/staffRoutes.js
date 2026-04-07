const express = require('express');
const staffController = require('../controllers/staffController');
const { protect } = require('../middleware/auth');
const {
  createStaffRules,
  updateStaffRules,
  businessIdParamRules,
  validate,
} = require('../validators/staffValidator');

const router = express.Router();

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
  validate,
  staffController.updateStaff
);

router.get(
  '/business/:businessId',
  businessIdParamRules(),
  validate,
  staffController.getStaffByBusiness
);

module.exports = router;

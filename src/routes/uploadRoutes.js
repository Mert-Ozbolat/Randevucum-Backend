const express = require('express');
const uploadController = require('../controllers/uploadController');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();

router.get(
  '/imagekit-auth',
  protect,
  restrictTo(ROLES.BUSINESS_OWNER, ROLES.SUPER_ADMIN),
  uploadController.imageKitAuth
);

module.exports = router;

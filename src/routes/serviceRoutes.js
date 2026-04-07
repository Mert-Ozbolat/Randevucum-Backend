const express = require('express');
const serviceController = require('../controllers/serviceController');
const { protect } = require('../middleware/auth');
const {
  createServiceRules,
  updateServiceRules,
  serviceIdParamRules,
  businessIdParamRules,
  validate,
} = require('../validators/serviceValidator');

const router = express.Router();

router.post(
  '/',
  protect,
  createServiceRules(),
  validate,
  serviceController.createService
);

router.put(
  '/:id',
  protect,
  serviceIdParamRules(),
  validate,
  serviceController.updateService
);

router.delete(
  '/:id',
  protect,
  serviceIdParamRules(),
  validate,
  serviceController.deleteService
);

router.get(
  '/business/:businessId',
  businessIdParamRules(),
  validate,
  serviceController.getServicesByBusiness
);

module.exports = router;

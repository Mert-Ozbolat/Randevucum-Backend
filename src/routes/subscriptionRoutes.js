const express = require('express');
const subscriptionController = require('../controllers/subscriptionController');
const { protect } = require('../middleware/auth');
const { subscribeRules, statusParamRules, cancelParamRules, validate } = require('../validators/subscriptionValidator');

const router = express.Router();

router.post(
  '/subscribe',
  protect,
  subscribeRules(),
  validate,
  subscriptionController.subscribe
);

router.get(
  '/status/:businessId',
  statusParamRules(),
  validate,
  subscriptionController.getStatus
);

router.patch(
  '/:id/cancel',
  protect,
  cancelParamRules(),
  validate,
  subscriptionController.cancelSubscription
);

module.exports = router;

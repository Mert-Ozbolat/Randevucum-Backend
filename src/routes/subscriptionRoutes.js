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
  protect,
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

router.patch(
  '/:id/reactivate',
  protect,
  cancelParamRules(),
  validate,
  subscriptionController.reactivateSubscription
);

module.exports = router;

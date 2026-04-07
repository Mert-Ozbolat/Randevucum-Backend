const Subscription = require('../models/Subscription');
const { error } = require('../utils/response');
const { SUBSCRIPTION_STATUS } = require('../config/constants');

/**
 * Ensure business has an active subscription (for creating new reservations, etc.)
 * Expects req.businessId or req.params.businessId to be set.
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    const businessId = req.businessId || req.params.businessId;
    if (!businessId) {
      return error(res, 400, 'Business ID is required.');
    }

    const subscription = await Subscription.findOne({
      businessId,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    })
      .sort({ endDate: -1 })
      .lean();

    if (!subscription) {
      if (process.env.ALLOW_RESERVATIONS_WITHOUT_SUBSCRIPTION === 'true') {
        return next();
      }
      return error(res, 403, 'No active subscription found for this business.');
    }

    const now = new Date();
    if (new Date(subscription.endDate) < now) {
      return error(res, 403, 'Subscription has expired. Please renew to accept new reservations.');
    }

    req.subscription = subscription;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Attach subscription status to req without blocking (for optional display)
 */
const attachSubscriptionStatus = async (req, res, next) => {
  try {
    const businessId = req.businessId || req.params.businessId;
    if (!businessId) return next();

    const subscription = await Subscription.findOne({ businessId })
      .sort({ endDate: -1 })
      .lean();

    if (subscription) {
      req.subscriptionStatus = {
        status: subscription.status,
        endDate: subscription.endDate,
        isActive:
          subscription.status === SUBSCRIPTION_STATUS.ACTIVE &&
          new Date(subscription.endDate) >= new Date(),
      };
    }
    next();
  } catch {
    next();
  }
};

module.exports = { requireActiveSubscription, attachSubscriptionStatus };

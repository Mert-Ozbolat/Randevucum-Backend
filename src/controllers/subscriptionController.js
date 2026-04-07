const Subscription = require('../models/Subscription');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { SUBSCRIPTION_STATUS } = require('../config/constants');
const { ROLES } = require('../config/constants');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /subscription/subscribe - Create or renew subscription for a business
 * Body: businessId
 * Business owner only; sets 30 days from now.
 */
exports.subscribe = asyncHandler(async (req, res) => {
  const { businessId } = req.body;
  if (!businessId) return error(res, 400, 'Business ID is required.');

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + MONTH_MS);

  const subscription = await Subscription.create({
    businessId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    startDate: now,
    endDate,
  });

  await subscription.populate('businessId', 'name businessType');
  return success(res, 201, subscription, 'Subscription activated successfully.');
});

/**
 * GET /subscription/status/:businessId - Get current subscription status for a business
 */
exports.getStatus = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const subscription = await Subscription.findOne({ businessId })
    .sort({ endDate: -1 })
    .populate('businessId', 'name businessType')
    .lean();

  if (!subscription) {
    return success(res, 200, {
      businessId,
      hasSubscription: false,
      status: null,
      endDate: null,
      isActive: false,
    }, 'OK');
  }

  const isActive =
    subscription.status === SUBSCRIPTION_STATUS.ACTIVE &&
    new Date(subscription.endDate) >= new Date();

  return success(res, 200, {
    ...subscription,
    isActive,
  }, 'OK');
});

/**
 * PATCH /subscription/:id/cancel - Cancel subscription (optional - set status to canceled)
 */
exports.cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return error(res, 404, 'Subscription not found.');

  const business = await Business.findById(subscription.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  subscription.status = SUBSCRIPTION_STATUS.CANCELED;
  subscription.canceledAt = new Date();
  await subscription.save();
  return success(res, 200, subscription, 'Subscription canceled.');
});

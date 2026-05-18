const Subscription = require('../models/Subscription');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { SUBSCRIPTION_STATUS } = require('../config/constants');
const { ROLES } = require('../config/constants');
const { getStaffQuota } = require('../utils/subscriptionLimits');
const { getStripe } = require('../config/stripe');
const { getBusinessBilling } = require('../utils/subscriptionBilling');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /subscription/subscribe - Demo abonelik (geliştirme)
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
    planKey: 'pro',
    isTrial: false,
    source: 'demo',
    startDate: now,
    endDate,
  });

  business.billingSuspended = false;
  if (!business.hasPaidSubscription) {
    business.hasPaidSubscription = true;
  }
  await business.save();

  await subscription.populate('businessId', 'name businessType');
  return success(res, 201, subscription, 'Subscription activated successfully.');
});

/**
 * GET /subscription/status/:businessId
 */
exports.getStatus = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const business = await Business.findById(businessId).select('ownerId billingSuspended hasPaidSubscription').lean();
  if (!business) return error(res, 404, 'Business not found.');

  if (req.user) {
    if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
      return error(res, 403, 'You do not own this business.');
    }
  }

  const billing = await getBusinessBilling(businessId);
  const quota = await getStaffQuota(businessId);
  const sub = billing.subscription;

  return success(
    res,
    200,
    {
      businessId,
      _id: sub?._id,
      hasSubscription: billing.hasSubscription,
      status: billing.status,
      endDate: billing.endDate,
      isActive: billing.isActive,
      canAcceptBookings: billing.canAcceptBookings,
      hasProAccess: billing.hasProAccess,
      planKey: quota.planKey,
      staffLimit: quota.limit,
      staffCount: quota.current,
      canAddStaff: quota.canAdd,
      isTrial: billing.isTrial,
      trialExpired: billing.trialExpired,
      needsRenewal: billing.needsRenewal,
      inGracePeriod: billing.inGracePeriod,
      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
      billingNotice: billing.billingNotice,
      billingSuspended: billing.billingSuspended,
      hasPaidSubscription: billing.hasPaidSubscription,
      stripeSubscriptionId: billing.stripeSubscriptionId,
      gracePeriodEndsAt: sub?.gracePeriodEndsAt || null,
    },
    'OK'
  );
});

/**
 * PATCH /subscription/:id/cancel — Dönem sonunda iptal (Stripe) veya demo iptal
 */
exports.cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return error(res, 404, 'Subscription not found.');

  const business = await Business.findById(subscription.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  if (subscription.stripeSubscriptionId) {
    const stripe = getStripe();
    if (!stripe) return error(res, 503, 'Stripe is not configured.');

    const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    subscription.cancelAtPeriodEnd = true;
    subscription.endDate = new Date(updated.current_period_end * 1000);
    subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
    await subscription.save();

    return success(
      res,
      200,
      subscription,
      'Abonelik dönem sonunda iptal edilecek. Bu tarihe kadar PRO erişiminiz devam eder.'
    );
  }

  subscription.cancelAtPeriodEnd = true;
  subscription.canceledAt = new Date();
  await subscription.save();

  return success(
    res,
    200,
    subscription,
    'Abonelik dönem sonunda sona erecek şekilde işaretlendi.'
  );
});

/**
 * PATCH /subscription/:id/reactivate — Stripe iptal talebini geri al
 */
exports.reactivateSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return error(res, 404, 'Subscription not found.');

  const business = await Business.findById(subscription.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  if (!subscription.stripeSubscriptionId) {
    return error(res, 400, 'Yalnızca Stripe abonelikleri yeniden etkinleştirilebilir.');
  }

  const stripe = getStripe();
  if (!stripe) return error(res, 503, 'Stripe is not configured.');

  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  subscription.cancelAtPeriodEnd = false;
  subscription.endDate = new Date(updated.current_period_end * 1000);
  subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
  await subscription.save();

  return success(res, 200, subscription, 'Abonelik yenileme tekrar açıldı.');
});

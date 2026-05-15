const Subscription = require('../models/Subscription');
const Staff = require('../models/Staff');
const { SUBSCRIPTION_STATUS } = require('../config/constants');
const { resolveProPriceIds } = require('../config/stripe');

/** Standart paket: en fazla 1 personel. Pro: sınırsız. */
const STAFF_LIMIT_STANDARD = 1;

function isProPlanKey(planKey) {
  return String(planKey || '').toLowerCase() === 'pro';
}

function staffLimitForPlan(planKey) {
  return isProPlanKey(planKey) ? null : STAFF_LIMIT_STANDARD;
}

/**
 * Aktif abonelik planı (yoksa standart kabul).
 */
async function getActivePlanForBusiness(businessId) {
  const now = new Date();
  const sub = await Subscription.findOne({
    businessId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    endDate: { $gte: now },
  })
    .sort({ endDate: -1 })
    .lean();

  if (!sub) {
    return { planKey: 'standard', isActive: false };
  }

  let planKey = sub.planKey || 'standard';
  if (!isProPlanKey(planKey)) {
    const proIds = resolveProPriceIds();
    if (sub.stripePriceId && proIds.includes(sub.stripePriceId)) {
      planKey = 'pro';
    }
  }

  return { planKey, isActive: true };
}

/**
 * Personel kotası: limit null = sınırsız (Pro).
 */
async function getStaffQuota(businessId) {
  const { planKey } = await getActivePlanForBusiness(businessId);
  const limit = staffLimitForPlan(planKey);
  const current = await Staff.countDocuments({ businessId });
  const canAdd = limit === null || current < limit;

  return {
    planKey,
    limit,
    current,
    canAdd,
  };
}

module.exports = {
  STAFF_LIMIT_STANDARD,
  staffLimitForPlan,
  getActivePlanForBusiness,
  getStaffQuota,
};

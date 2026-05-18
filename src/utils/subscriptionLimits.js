const Staff = require('../models/Staff');
const { getBusinessBilling, isProPlanKey } = require('./subscriptionBilling');

/** Standart paket: en fazla 1 personel. Pro: sınırsız. */
const STAFF_LIMIT_STANDARD = 1;

function staffLimitForPlan(planKey) {
  return isProPlanKey(planKey) ? null : STAFF_LIMIT_STANDARD;
}

/**
 * Aktif abonelik planı (yoksa standart kabul).
 */
async function getActivePlanForBusiness(businessId) {
  const billing = await getBusinessBilling(businessId);
  return {
    planKey: billing.hasProAccess ? 'pro' : billing.planKey || 'standard',
    isActive: billing.hasProAccess,
  };
}

/**
 * Personel kotası: limit null = sınırsız (Pro).
 */
async function getStaffQuota(businessId) {
  const billing = await getBusinessBilling(businessId);
  const planKey = billing.hasProAccess ? 'pro' : billing.planKey || 'standard';
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

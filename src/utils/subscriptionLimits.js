const Staff = require('../models/Staff');
const Reservation = require('../models/Reservation');
const { RESERVATION_STATUS } = require('../config/constants');
const { getBusinessBilling, isProPlanKey } = require('./subscriptionBilling');

/** Standart paket: en fazla 1 personel. Pro: sınırsız. */
const STAFF_LIMIT_STANDARD = 1;

/** Standart paket: ayda en fazla randevu (takvim ayı). Pro: sınırsız. */
const RESERVATION_LIMIT_STANDARD = Math.max(
  1,
  parseInt(process.env.STANDARD_MONTHLY_RESERVATION_LIMIT || '30', 10) || 30
);

function staffLimitForPlan(planKey) {
  return isProPlanKey(planKey) ? null : STAFF_LIMIT_STANDARD;
}

function reservationLimitForPlan(planKey, hasProAccess) {
  if (hasProAccess || isProPlanKey(planKey)) return null;
  return RESERVATION_LIMIT_STANDARD;
}

function currentMonthRange(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { monthStart, monthEnd };
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

/**
 * Aylık randevu kotası: limit null = sınırsız (Pro / deneme).
 * İptal edilenler sayılmaz.
 */
async function getReservationQuota(businessId, now = new Date()) {
  const billing = await getBusinessBilling(businessId);
  const planKey = billing.hasProAccess ? 'pro' : billing.planKey || 'standard';
  const limit = reservationLimitForPlan(planKey, billing.hasProAccess);
  const { monthStart, monthEnd } = currentMonthRange(now);

  const current = await Reservation.countDocuments({
    businessId,
    status: {
      $in: [
        RESERVATION_STATUS.PENDING,
        RESERVATION_STATUS.APPROVED,
        RESERVATION_STATUS.COMPLETED,
      ],
    },
    createdAt: { $gte: monthStart, $lt: monthEnd },
  });

  const canAccept = limit === null || current < limit;

  return {
    planKey,
    limit,
    current,
    canAccept,
    monthStart,
    monthEnd,
  };
}

module.exports = {
  STAFF_LIMIT_STANDARD,
  RESERVATION_LIMIT_STANDARD,
  staffLimitForPlan,
  reservationLimitForPlan,
  currentMonthRange,
  getActivePlanForBusiness,
  getStaffQuota,
  getReservationQuota,
};

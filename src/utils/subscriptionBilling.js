const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const { SUBSCRIPTION_STATUS } = require('../config/constants');
const { resolveProPriceIds } = require('../config/stripe');

const GRACE_DAYS = Math.max(1, parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '7', 10) || 7);

const BILLING_NOTICE_PAYMENT_FAILED =
  'Ödemeniz alınamadı. İşletmeniz offline moda alındı; Keşfet ve randevu kapalı. Ödeme yönteminizi güncelleyin.';

const BILLING_NOTICE_SUSPENDED =
  'Aboneliğiniz askıda. Müşteriler sizi göremez ve randevu alamaz. Aboneliği yenileyin.';

function formatDateTr(date) {
  return new Date(date).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Herkese açık listelerde görünür işletme filtresi */
function publicBusinessFilter(extra = {}) {
  return {
    ...extra,
    isActive: true,
    billingSuspended: { $ne: true },
  };
}

function buildRenewalNotice(sub, daysLeft) {
  const endLabel = formatDateTr(sub.endDate);
  const hasStripe = Boolean(sub.stripeSubscriptionId);
  const autoRenews = hasStripe && !sub.cancelAtPeriodEnd && !sub.isTrial;

  if (autoRenews) {
    return `Aboneliğiniz ${endLabel} tarihinde kayıtlı kartınızdan otomatik yenilenecek. Ek işlem gerekmez.`;
  }
  if (daysLeft <= 1) {
    return `Aboneliğiniz yarın (${endLabel}) sona eriyor. Kesintisiz hizmet için aboneliğinizi yenileyin.`;
  }
  return `Aboneliğiniz ${endLabel} tarihinde sona eriyor (${daysLeft} gün kaldı). Lütfen aboneliğinizi yenileyin.`;
}

function isProPlanKey(planKey) {
  return String(planKey || '').toLowerCase() === 'pro';
}

function resolvePlanKeyFromSub(sub) {
  let planKey = sub.planKey || 'standard';
  if (!isProPlanKey(planKey)) {
    const proIds = resolveProPriceIds();
    if (sub.stripePriceId && proIds.includes(sub.stripePriceId)) {
      planKey = 'pro';
    }
  }
  return planKey;
}

function isInGracePeriod(sub, now = new Date()) {
  if (!sub?.paymentFailedAt || !sub?.gracePeriodEndsAt) return false;
  return new Date(sub.gracePeriodEndsAt) >= now;
}

function subscriptionPeriodActive(sub, now = new Date()) {
  if (sub.cancelAtPeriodEnd && new Date(sub.endDate) >= now) return true;
  if (sub.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;
  if (isInGracePeriod(sub, now)) return true;
  return new Date(sub.endDate) >= now;
}

/**
 * Aktif veya grace dönemindeki en güncel abonelik kaydı.
 */
async function findCurrentSubscription(businessId) {
  const now = new Date();
  return Subscription.findOne({
    businessId,
    $or: [
      { status: SUBSCRIPTION_STATUS.ACTIVE },
      {
        status: SUBSCRIPTION_STATUS.CANCELED,
        cancelAtPeriodEnd: true,
        endDate: { $gte: now },
      },
    ],
  })
    .sort({ endDate: -1 })
    .lean();
}

async function getBusinessBilling(businessId) {
  const business = await Business.findById(businessId)
    .select('hasPaidSubscription billingSuspended isActive name')
    .lean();

  const sub = await findCurrentSubscription(businessId);
  const now = new Date();

  if (business?.billingSuspended) {
    return {
      businessId,
      hasSubscription: Boolean(sub),
      subscription: sub,
      canAcceptBookings: false,
      hasProAccess: false,
      billingSuspended: true,
      isTrial: Boolean(sub?.isTrial),
      trialExpired: false,
      needsRenewal: true,
      inGracePeriod: false,
      cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
      billingNotice: sub?.billingNotice || BILLING_NOTICE_PAYMENT_FAILED,
      planKey: 'standard',
      isActive: false,
      endDate: sub?.endDate || null,
      status: sub?.status || null,
    };
  }

  if (!sub) {
    return {
      businessId,
      hasSubscription: false,
      subscription: null,
      canAcceptBookings: false,
      hasProAccess: false,
      billingSuspended: false,
      isTrial: false,
      trialExpired: false,
      needsRenewal: true,
      inGracePeriod: false,
      cancelAtPeriodEnd: false,
      billingNotice: null,
      planKey: 'standard',
      isActive: false,
      endDate: null,
      status: null,
    };
  }

  const periodActive = subscriptionPeriodActive(sub, now);
  const inGrace = isInGracePeriod(sub, now);
  const planKey = resolvePlanKeyFromSub(sub);
  const trialExpired =
    Boolean(sub.isTrial) && !sub.stripeSubscriptionId && new Date(sub.endDate) < now;
  const needsRenewal =
    trialExpired || (!periodActive && !inGrace && sub.status !== SUBSCRIPTION_STATUS.CANCELED);

  const isActive = periodActive || (sub.cancelAtPeriodEnd && new Date(sub.endDate) >= now);

  return {
    businessId,
    hasSubscription: true,
    subscription: sub,
    canAcceptBookings: isActive && !business?.billingSuspended,
    hasProAccess: isActive && isProPlanKey(planKey),
    billingSuspended: false,
    isTrial: Boolean(sub.isTrial),
    trialExpired,
    needsRenewal,
    inGracePeriod: inGrace,
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    billingNotice: sub.billingNotice || null,
    planKey,
    isActive,
    endDate: sub.endDate,
    status: sub.status,
    hasPaidSubscription: Boolean(business?.hasPaidSubscription),
    stripeSubscriptionId: sub.stripeSubscriptionId || null,
  };
}

async function suspendBusinessBilling(businessId, { notice } = {}) {
  const msg = notice || BILLING_NOTICE_SUSPENDED;
  await Business.findByIdAndUpdate(businessId, {
    $set: { billingSuspended: true, isActive: false },
  });
  await Subscription.updateMany(
    { businessId, status: SUBSCRIPTION_STATUS.ACTIVE },
    {
      $set: {
        status: SUBSCRIPTION_STATUS.EXPIRED,
        billingNotice: msg,
      },
    }
  );
}

async function clearBillingFailure(businessId) {
  await Business.findByIdAndUpdate(businessId, {
    $set: { billingSuspended: false },
  });
  await Subscription.updateMany(
    { businessId },
    {
      $unset: {
        paymentFailedAt: '',
        gracePeriodEndsAt: '',
        billingNotice: '',
      },
    }
  );
}

async function startPaymentGracePeriod(businessId, subscriptionId) {
  const now = new Date();
  const graceEnds = new Date(now);
  graceEnds.setDate(graceEnds.getDate() + GRACE_DAYS);

  await Subscription.findByIdAndUpdate(subscriptionId, {
    $set: {
      paymentFailedAt: now,
      gracePeriodEndsAt: graceEnds,
      billingNotice: BILLING_NOTICE_PAYMENT_FAILED,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    },
  });

  return { graceEnds, notice: BILLING_NOTICE_PAYMENT_FAILED };
}

/**
 * Abonelik bitişine yaklaşan işletmelere uyarı mesajı yazar.
 */
async function applyRenewalWarnings({ now = new Date() } = {}) {
  let updated = 0;
  const warnDays = [7, 3, 1];

  for (const daysLeft of warnDays) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() + daysLeft);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const subs = await Subscription.find({
      status: SUBSCRIPTION_STATUS.ACTIVE,
      endDate: { $gte: dayStart, $lt: dayEnd },
      paymentFailedAt: null,
    }).lean();

    for (const sub of subs) {
      const business = await Business.findById(sub.businessId).select('billingSuspended').lean();
      if (business?.billingSuspended) continue;

      const notice = buildRenewalNotice(sub, daysLeft);
      await Subscription.findByIdAndUpdate(sub._id, { $set: { billingNotice: notice } });
      updated += 1;
    }
  }

  return updated;
}

/**
 * Süresi dolan grace / trial kayıtlarını işler.
 */
async function runSubscriptionBillingMaintenance({ now = new Date() } = {}) {
  let graceSuspended = 0;
  let trialsExpired = 0;
  let renewalWarnings = 0;

  renewalWarnings = await applyRenewalWarnings({ now });

  const graceExpired = await Subscription.find({
    status: SUBSCRIPTION_STATUS.ACTIVE,
    gracePeriodEndsAt: { $lt: now },
    paymentFailedAt: { $ne: null },
  }).lean();

  for (const sub of graceExpired) {
    await suspendBusinessBilling(sub.businessId, { notice: BILLING_NOTICE_PAYMENT_FAILED });
    graceSuspended += 1;
  }

  const expiredTrials = await Subscription.find({
    isTrial: true,
    stripeSubscriptionId: { $in: [null, ''] },
    status: SUBSCRIPTION_STATUS.ACTIVE,
    endDate: { $lt: now },
    $or: [{ gracePeriodEndsAt: null }, { gracePeriodEndsAt: { $exists: false } }],
  }).lean();

  for (const sub of expiredTrials) {
    await Subscription.findByIdAndUpdate(sub._id, {
      $set: { status: SUBSCRIPTION_STATUS.EXPIRED },
    });
    const business = await Business.findById(sub.businessId).select('billingSuspended').lean();
    if (!business?.billingSuspended) {
      await Business.findByIdAndUpdate(sub.businessId, { $set: { isActive: false } });
    }
    trialsExpired += 1;
  }

  const expiredPaid = await Subscription.find({
    status: SUBSCRIPTION_STATUS.ACTIVE,
    endDate: { $lt: now },
    isTrial: { $ne: true },
    stripeSubscriptionId: { $exists: true, $ne: null },
    $or: [{ gracePeriodEndsAt: null }, { gracePeriodEndsAt: { $lt: now } }],
  }).lean();

  let paidExpired = 0;
  for (const sub of expiredPaid) {
    await Subscription.findByIdAndUpdate(sub._id, { $set: { status: SUBSCRIPTION_STATUS.EXPIRED } });
    await suspendBusinessBilling(sub.businessId);
    paidExpired += 1;
  }

  return { ok: true, graceSuspended, trialsExpired, paidExpired, renewalWarnings };
}

module.exports = {
  GRACE_DAYS,
  BILLING_NOTICE_PAYMENT_FAILED,
  BILLING_NOTICE_SUSPENDED,
  formatDateTr,
  publicBusinessFilter,
  buildRenewalNotice,
  isProPlanKey,
  resolvePlanKeyFromSub,
  isInGracePeriod,
  subscriptionPeriodActive,
  findCurrentSubscription,
  getBusinessBilling,
  suspendBusinessBilling,
  clearBillingFailure,
  startPaymentGracePeriod,
  applyRenewalWarnings,
  runSubscriptionBillingMaintenance,
};

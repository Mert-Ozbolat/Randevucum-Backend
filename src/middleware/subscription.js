const { error } = require('../utils/response');
const { getBusinessBilling } = require('../utils/subscriptionBilling');

/**
 * İşletmenin randevu alabilmesi için geçerli abonelik / grace / trial gerekir.
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    const businessId = req.businessId || req.params.businessId || req.body?.businessId;
    if (!businessId) {
      return error(res, 400, 'Business ID is required.');
    }

    if (process.env.ALLOW_RESERVATIONS_WITHOUT_SUBSCRIPTION === 'true') {
      return next();
    }

    const billing = await getBusinessBilling(businessId);

    if (!billing.canAcceptBookings) {
      if (billing.billingSuspended) {
        return error(
          res,
          403,
          'Abonelik askıya alındı. Yeni randevu alınamaz. Lütfen aboneliğinizi yenileyin.'
        );
      }
      if (billing.trialExpired || billing.needsRenewal) {
        return error(
          res,
          403,
          'Deneme süreniz sona erdi. Randevu almaya devam etmek için PRO abonelik satın alın.'
        );
      }
      return error(res, 403, 'Aktif abonelik bulunamadı. Lütfen aboneliğinizi yenileyin.');
    }

    req.subscription = billing.subscription;
    req.billing = billing;
    next();
  } catch (err) {
    next(err);
  }
};

const attachSubscriptionStatus = async (req, res, next) => {
  try {
    const businessId = req.businessId || req.params.businessId;
    if (!businessId) return next();

    const billing = await getBusinessBilling(businessId);
    req.subscriptionStatus = {
      status: billing.status,
      endDate: billing.endDate,
      isActive: billing.isActive,
      canAcceptBookings: billing.canAcceptBookings,
    };
    next();
  } catch {
    next();
  }
};

module.exports = { requireActiveSubscription, attachSubscriptionStatus };

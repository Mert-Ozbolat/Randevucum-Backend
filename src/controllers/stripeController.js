const mongoose = require('mongoose');
const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { SUBSCRIPTION_STATUS, ROLES } = require('../config/constants');
const {
  getStripe,
  resolveCheckoutPlans,
  resolveFrontendBaseUrl,
  resolveProPriceIds,
  getPublicPlansCatalog,
} = require('../config/stripe');
const {
  clearBillingFailure,
  getBusinessBilling,
  suspendBusinessBilling,
  BILLING_NOTICE_PAYMENT_FAILED,
} = require('../utils/subscriptionBilling');
const { syncBusinessPublicActivation } = require('../utils/businessSetup');

function mapStripeSubscriptionStatus(stripeStatus, { cancelAtPeriodEnd, periodEnd } = {}) {
  const now = Date.now();
  const periodStillValid = periodEnd && periodEnd * 1000 >= now;

  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    return SUBSCRIPTION_STATUS.ACTIVE;
  }
  if (stripeStatus === 'past_due') {
    return SUBSCRIPTION_STATUS.ACTIVE;
  }
  if (stripeStatus === 'canceled' && cancelAtPeriodEnd && periodStillValid) {
    return SUBSCRIPTION_STATUS.ACTIVE;
  }
  if (
    stripeStatus === 'canceled' ||
    stripeStatus === 'unpaid' ||
    stripeStatus === 'incomplete_expired'
  ) {
    return SUBSCRIPTION_STATUS.CANCELED;
  }
  return SUBSCRIPTION_STATUS.EXPIRED;
}

async function upsertSubscriptionFromStripeSubscription(businessId, sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const endDate = new Date(sub.current_period_end * 1000);
  const startDate = new Date(sub.current_period_start * 1000);
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const status = mapStripeSubscriptionStatus(sub.status, {
    cancelAtPeriodEnd,
    periodEnd: sub.current_period_end,
  });
  const firstItem = Array.isArray(sub.items?.data) ? sub.items.data[0] : null;
  const stripePriceId =
    firstItem && firstItem.price && (typeof firstItem.price === 'string' ? firstItem.price : firstItem.price.id)
      ? typeof firstItem.price === 'string'
        ? firstItem.price
        : firstItem.price.id
      : null;
  const proIds = resolveProPriceIds();
  const planKey = stripePriceId && proIds.includes(stripePriceId) ? 'pro' : 'standard';

  const setFields = {
    businessId: new mongoose.Types.ObjectId(businessId),
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    stripePriceId: stripePriceId || undefined,
    planKey,
    status,
    startDate,
    endDate,
    isTrial: false,
    source: 'stripe',
    cancelAtPeriodEnd,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
  };

  if (sub.status === 'active' || sub.status === 'trialing') {
    setFields.paymentFailedAt = null;
    setFields.gracePeriodEndsAt = null;
    setFields.billingNotice = null;
  }

  await Subscription.findOneAndUpdate(
    { stripeSubscriptionId: sub.id },
  {
      $set: setFields,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Business.findByIdAndUpdate(businessId, {
    $set: {
      hasPaidSubscription: true,
      billingSuspended: false,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
  });

  await clearBillingFailure(businessId);
  try {
    await syncBusinessPublicActivation(businessId);
  } catch (e) {
    console.warn('[stripe] syncBusinessPublicActivation failed', e?.message || e);
  }
}

async function resolveBusinessIdFromStripeSubscription(sub) {
  let businessId = sub.metadata?.businessId;
  if (!businessId) {
    const existing = await Subscription.findOne({ stripeSubscriptionId: sub.id }).lean();
    businessId = existing?.businessId?.toString();
  }
  return businessId;
}

/**
 * GET /payments/stripe/config — Authenticated; tells UI if Checkout is available.
 */
exports.getPublicPlans = asyncHandler(async (req, res) => {
  const plans = await getPublicPlansCatalog();
  const stripe = getStripe();
  return success(res, 200, {
    plans,
    checkoutEnabled: Boolean(stripe && plans.length > 0),
    trialDays: Math.max(1, parseInt(process.env.BUSINESS_TRIAL_DAYS || '30', 10) || 30),
  }, 'OK');
});

exports.getStripeConfig = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  const plans = await getPublicPlansCatalog();
  const checkoutEnabled = Boolean(stripe && plans.length > 0);
  return success(
    res,
    200,
    {
      checkoutEnabled,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      plans,
      trialDays: Math.max(1, parseInt(process.env.BUSINESS_TRIAL_DAYS || '30', 10) || 30),
    },
    'OK'
  );
});

/**
 * POST /payments/stripe/billing-portal — Ödeme yöntemi güncelleme (grace / past_due)
 */
exports.createBillingPortalSession = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return error(res, 503, 'Stripe is not configured.');

  const { businessId } = req.body;
  if (!businessId) return error(res, 400, 'businessId is required.');

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }
  if (!business.stripeCustomerId) {
    return error(res, 400, 'Stripe müşteri kaydı yok. Önce abonelik satın alın.');
  }

  const base = resolveFrontendBaseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripeCustomerId,
    return_url: `${base}/dashboard/business/subscription`,
  });

  return success(res, 200, { url: session.url }, 'OK');
});

/**
 * POST /payments/stripe/checkout-session
 */
exports.createCheckoutSession = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  const plans = await resolveCheckoutPlans();
  const allowed = new Set(plans.map((p) => p.priceId));
  const requested = (req.body.priceId || '').trim();
  const fallback = plans[0]?.priceId || '';
  const priceId = requested && allowed.has(requested) ? requested : fallback;

  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[stripe][checkout-session] start', { reqId, businessId: req.body?.businessId, priceId });

  if (!stripe) return error(res, 503, 'Stripe is not configured (STRIPE_SECRET_KEY).');
  if (!priceId || !allowed.has(priceId)) {
    return error(res, 400, 'Geçersiz paket (priceId).');
  }

  const { businessId } = req.body;
  if (!businessId) return error(res, 400, 'businessId is required.');

  if (req.user.role !== ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'Only business owners can start subscription checkout.');
  }

  const business = await Business.findById(businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  const billing = await getBusinessBilling(businessId);
  if (billing.isTrial && billing.isActive && !billing.stripeSubscriptionId) {
    return error(
      res,
      403,
      'Ücretsiz PRO deneme süreniz devam ediyor. Paket satın almak için deneme bitene kadar bekleyin; bu sürede tüm PRO özelliklerini kullanabilirsiniz.'
    );
  }

  const base = resolveFrontendBaseUrl();
  const successUrl = `${base}/dashboard/business/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/dashboard/business/subscription?checkout=cancel`;

  const sessionParams = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: businessId,
    metadata: { businessId, userId: req.user._id.toString() },
    subscription_data: {
      metadata: { businessId, userId: req.user._id.toString() },
    },
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    allow_promotion_codes: true,
  };

  if (business.stripeCustomerId) {
    sessionParams.customer = business.stripeCustomerId;
  } else {
    sessionParams.customer_email = req.user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  console.log('[stripe][checkout-session] created', { reqId, sessionId: session.id });

  return success(res, 200, { url: session.url, sessionId: session.id }, 'OK');
});

/**
 * POST /payments/stripe/webhook
 */
exports.stripeWebhook = async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.warn('[stripe] Webhook ignored: missing config.');
    return res.status(503).send('Webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const businessId = session.metadata?.businessId || session.client_reference_id;
        if (!businessId) break;
        const stripeSubId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!stripeSubId) break;
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        await upsertSubscriptionFromStripeSubscription(businessId, sub);
        await Subscription.updateMany(
          { businessId, isTrial: true, stripeSubscriptionId: { $in: [null, ''] } },
          { $set: { status: SUBSCRIPTION_STATUS.EXPIRED } }
        );
        const cus = session.customer;
        const customerId = typeof cus === 'string' ? cus : cus?.id;
        if (customerId) {
          await Business.findByIdAndUpdate(businessId, { $set: { stripeCustomerId: customerId } });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const businessId = await resolveBusinessIdFromStripeSubscription(sub);
        if (businessId) await upsertSubscriptionFromStripeSubscription(businessId, sub);
        if (sub.status === 'unpaid') {
          const bid = businessId || (await resolveBusinessIdFromStripeSubscription(sub));
          if (bid) await suspendBusinessBilling(bid);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await Subscription.findOneAndUpdate(
          { stripeSubscriptionId: sub.id },
          {
            $set: {
              status: SUBSCRIPTION_STATUS.CANCELED,
              canceledAt: new Date(),
              cancelAtPeriodEnd: false,
            },
          }
        );
        const businessId = await resolveBusinessIdFromStripeSubscription(sub);
        if (businessId) {
          const stillActive = await Subscription.findOne({
            businessId,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            endDate: { $gte: new Date() },
          }).lean();
          if (!stillActive) {
            await suspendBusinessBilling(businessId);
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const stripeSubId =
          typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!stripeSubId) break;
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        const businessId = await resolveBusinessIdFromStripeSubscription(sub);
        if (!businessId) break;
        await suspendBusinessBilling(businessId, { notice: BILLING_NOTICE_PAYMENT_FAILED });
        console.log('[stripe] invoice.payment_failed — business suspended', { businessId, stripeSubId });
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        const stripeSubId =
          typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!stripeSubId) break;
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        const businessId = await resolveBusinessIdFromStripeSubscription(sub);
        if (businessId) {
          await upsertSubscriptionFromStripeSubscription(businessId, sub);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe] Webhook handler error:', e);
    return res.status(500).json({ received: false });
  }

  return res.json({ received: true });
};

module.exports.upsertSubscriptionFromStripeSubscription = upsertSubscriptionFromStripeSubscription;

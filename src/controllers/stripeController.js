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
} = require('../config/stripe');

function mapStripeSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') {
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
  const status = mapStripeSubscriptionStatus(sub.status);
  const firstItem = Array.isArray(sub.items?.data) ? sub.items.data[0] : null;
  const stripePriceId =
    firstItem && firstItem.price && (typeof firstItem.price === 'string' ? firstItem.price : firstItem.price.id)
      ? (typeof firstItem.price === 'string' ? firstItem.price : firstItem.price.id)
      : null;
  const proIds = resolveProPriceIds();
  const planKey = stripePriceId && proIds.includes(stripePriceId) ? 'pro' : 'standard';

  await Subscription.findOneAndUpdate(
    { stripeSubscriptionId: sub.id },
    {
      $set: {
        businessId: new mongoose.Types.ObjectId(businessId),
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customerId,
        stripePriceId: stripePriceId || undefined,
        planKey,
        status,
        startDate,
        endDate,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Business.findByIdAndUpdate(businessId, {
    $set: { hasPaidSubscription: true, ...(customerId ? { stripeCustomerId: customerId } : {}) },
  });
}

/**
 * GET /payments/stripe/config — Authenticated; tells UI if Checkout is available.
 */
exports.getStripeConfig = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  const plans = resolveCheckoutPlans();
  const checkoutEnabled = Boolean(stripe && plans.length > 0);
  return success(
    res,
    200,
    {
      checkoutEnabled,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      plans,
    },
    'OK'
  );
});

/**
 * POST /payments/stripe/checkout-session
 * Body: { businessId, priceId? } — priceId overrides env default (same Stripe account).
 */
exports.createCheckoutSession = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  const plans = resolveCheckoutPlans();
  const allowed = new Set(plans.map((p) => p.priceId));
  const requested = (req.body.priceId || '').trim();
  const fallback = plans[0]?.priceId || '';
  const priceId =
    requested && allowed.has(requested) ? requested : fallback;

  // Debug logs (safe): never log STRIPE_SECRET_KEY / webhook secrets.
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[stripe][checkout-session] start', {
    reqId,
    userId: req.user?._id?.toString?.() || null,
    role: req.user?.role || null,
    businessId: req.body?.businessId || null,
    requestedPriceId: requested || null,
    resolvedPriceId: priceId || null,
    allowedPlanCount: plans.length,
    allowedPriceIds: plans.map((p) => p.priceId),
    frontendUrlSet: Boolean(process.env.FRONTEND_URL),
    secretKeySet: Boolean(process.env.STRIPE_SECRET_KEY),
    webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  });

  if (!stripe) {
    console.warn('[stripe][checkout-session] stripe client missing', { reqId });
    return error(res, 503, 'Stripe is not configured (STRIPE_SECRET_KEY).');
  }
  if (!priceId || !allowed.has(priceId)) {
    console.warn('[stripe][checkout-session] invalid priceId', {
      reqId,
      requested: requested || '(empty)',
      allowed: plans.map((p) => p.priceId),
    });
    return error(
      res,
      400,
      `Geçersiz veya tanımsız paket (priceId). Gönderilen: ${requested || '(boş)'} | Sunucuda tanımlı paketler: ${plans
        .map((p) => p.priceId)
        .join(', ') || '(yok)'}`
    );
  }

  const { businessId } = req.body;
  if (!businessId) {
    console.warn('[stripe][checkout-session] missing businessId', { reqId });
    return error(res, 400, 'businessId is required.');
  }

  if (req.user.role !== ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    console.warn('[stripe][checkout-session] forbidden role', { reqId, role: req.user.role });
    return error(res, 403, 'Only business owners can start subscription checkout.');
  }

  const business = await Business.findById(businessId);
  if (!business) {
    console.warn('[stripe][checkout-session] business not found', { reqId, businessId });
    return error(res, 404, 'Business not found.');
  }
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    console.warn('[stripe][checkout-session] business ownership mismatch', {
      reqId,
      businessId,
      ownerId: business.ownerId?.toString?.() || null,
      userId: req.user._id?.toString?.() || null,
    });
    return error(res, 403, 'You do not own this business.');
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
    metadata: {
      businessId,
      userId: req.user._id.toString(),
    },
    subscription_data: {
      metadata: {
        businessId,
        userId: req.user._id.toString(),
      },
    },
    allow_promotion_codes: true,
  };

  if (business.stripeCustomerId) {
    sessionParams.customer = business.stripeCustomerId;
  } else {
    sessionParams.customer_email = req.user.email;
  }

  console.log('[stripe][checkout-session] creating session', {
    reqId,
    mode: sessionParams.mode,
    lineItems: sessionParams.line_items,
    customerProvided: Boolean(sessionParams.customer),
    customerEmailProvided: Boolean(sessionParams.customer_email),
    successUrl,
    cancelUrl,
  });
  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e);
    console.error('[stripe][checkout-session] stripe error', { reqId, message: msg });
    // Common misconfig: prod_... (product) instead of price_... (price)
    if (msg.includes('No such price') || msg.includes('No such plan')) {
      return error(
        res,
        400,
        `Stripe fiyatı bulunamadı. priceId bir Price olmalı (price_...). Siz prod_... (Product) göndermiş olabilirsiniz. Gönderilen: ${priceId}`
      );
    }
    throw e;
  }
  console.log('[stripe][checkout-session] created', { reqId, sessionId: session.id, hasUrl: Boolean(session.url) });

  return success(res, 200, { url: session.url, sessionId: session.id }, 'OK');
});

/**
 * POST /payments/stripe/webhook — Raw body only; registered before express.json in app.js
 */
exports.stripeWebhook = async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    console.warn('[stripe] Webhook ignored: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing.');
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
        if (!businessId) {
          console.warn('[stripe] checkout.session.completed without businessId metadata');
          break;
        }
        const stripeSubId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (!stripeSubId) break;
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        await upsertSubscriptionFromStripeSubscription(businessId, sub);
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
        let businessId = sub.metadata?.businessId;
        if (!businessId) {
          const existing = await Subscription.findOne({ stripeSubscriptionId: sub.id }).lean();
          businessId = existing?.businessId?.toString();
        }
        if (businessId) await upsertSubscriptionFromStripeSubscription(businessId, sub);
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
            },
          }
        );
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

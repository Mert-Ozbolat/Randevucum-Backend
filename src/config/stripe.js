const Stripe = require('stripe');

let client = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });
  }
  return client;
}

function resolveDefaultPriceId() {
  const plans = resolveCheckoutPlans();
  return plans[0]?.priceId || '';
}

/**
 * Checkout’ta seçilebilir paketler (her biri Stripe’daki bir recurring Price ID: price_...).
 * Tek sk/pk ile sınırsız fiyat kullanılabilir — her paket için Dashboard’da ayrı Price oluşturun.
 */
function resolveCheckoutPlans() {
  const rows = [
    { id: process.env.STRIPE_PRICE_ID, label: process.env.STRIPE_PRICE_LABEL },
    { id: process.env.STRIPE_PRICE_ID_MONTHLY, label: process.env.STRIPE_PRICE_LABEL_MONTHLY },
    { id: process.env.STRIPE_PRICE_ID_2, label: process.env.STRIPE_PRICE_LABEL_2 },
    { id: process.env.STRIPE_PRICE_ID_3, label: process.env.STRIPE_PRICE_LABEL_3 },
  ];
  const seen = new Set();
  const plans = [];
  let n = 0;
  for (const { id, label } of rows) {
    const priceId = (id || '').trim();
    // Guard: Stripe Checkout line_items expects a Price id (price_...), not Product id (prod_...)
    if (priceId && !priceId.startsWith('price_')) {
      console.warn(
        '[stripe] Ignoring invalid STRIPE_PRICE_* value (expected price_...):',
        priceId
      );
      continue;
    }
    if (!priceId || seen.has(priceId)) continue;
    seen.add(priceId);
    n += 1;
    const defaultLabel = n === 1 ? 'Paket 1' : `Paket ${n}`;
    plans.push({
      priceId,
      label: ((label || defaultLabel).trim() || defaultLabel).slice(0, 80),
    });
  }
  return plans;
}

function resolveFrontendBaseUrl() {
  const u = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return u;
}

function resolveProPriceIds() {
  const ids = [
    process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_PRO_PRICE_IDS,
    process.env.STRIPE_PRICE_ID_2, // Pro paket Price ID (price_... olmalı, prod_ değil)
  ]
    .filter(Boolean)
    .flatMap((x) => String(x).split(','))
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((id) => id.startsWith('price_'));
  return Array.from(new Set(ids));
}

module.exports = {
  getStripe,
  resolveDefaultPriceId,
  resolveCheckoutPlans,
  resolveFrontendBaseUrl,
  resolveProPriceIds,
};

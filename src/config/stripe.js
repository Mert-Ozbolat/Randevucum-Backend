const Stripe = require('stripe');

let client = null;

/** Kısa süreli önbellek — her istekte Stripe’a gitmemek için */
let plansCatalogCache = null;
let plansCatalogCacheAt = 0;
const PLANS_CACHE_MS = 5 * 60 * 1000;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });
  }
  return client;
}

function formatTryAmount(amount, currency = 'TRY') {
  if (amount == null || Number.isNaN(amount)) return null;
  const cur = String(currency || 'try').toUpperCase();
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: cur.length === 3 ? cur : 'TRY',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${cur}`;
  }
}

function envPlanRows() {
  return [
    { rawId: process.env.STRIPE_PRICE_ID, label: process.env.STRIPE_PRICE_LABEL },
    { rawId: process.env.STRIPE_PRICE_ID_MONTHLY, label: process.env.STRIPE_PRICE_LABEL_MONTHLY },
    { rawId: process.env.STRIPE_PRICE_ID_2, label: process.env.STRIPE_PRICE_LABEL_2 },
    { rawId: process.env.STRIPE_PRICE_ID_3, label: process.env.STRIPE_PRICE_LABEL_3 },
  ];
}

/**
 * price_... doğrudan; prod_... ise Stripe’dan varsayılan / ilk recurring price çözülür.
 */
async function resolveToPriceId(stripe, rawId) {
  const id = String(rawId || '').trim();
  if (!id) return null;
  if (id.startsWith('price_')) return id;

  if (id.startsWith('prod_')) {
    try {
      const product = await stripe.products.retrieve(id, { expand: ['default_price'] });
      const dp = product.default_price;
      const priceId = typeof dp === 'string' ? dp : dp?.id;
      if (priceId && priceId.startsWith('price_')) return priceId;
    } catch (e) {
      console.warn('[stripe] product retrieve failed', { id, message: e?.message });
    }

    try {
      const prices = await stripe.prices.list({ product: id, active: true, limit: 20 });
      const recurring =
        prices.data.find((p) => p.type === 'recurring' && p.recurring) || prices.data[0];
      if (recurring?.id?.startsWith('price_')) return recurring.id;
    } catch (e) {
      console.warn('[stripe] prices.list failed', { id, message: e?.message });
    }
  }

  console.warn(
    '[stripe] STRIPE_PRICE_* geçersiz veya çözülemedi (price_... veya prod_... olmalı):',
    id
  );
  return null;
}

function inferPlanKey(priceId, label, proPriceIds, index) {
  if (proPriceIds.includes(priceId)) return 'pro';
  const lab = String(label || '').toLowerCase();
  if (lab.includes('pro')) return 'pro';
  if (index === 1 && proPriceIds.length === 0) return 'standard';
  return 'standard';
}

/**
 * STRIPE_PRICE_ID / STRIPE_PRICE_ID_2 (+ etiketler) → Stripe Price API → liste fiyatı
 */
async function buildPlansFromEnv({ bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && plansCatalogCache && now - plansCatalogCacheAt < PLANS_CACHE_MS) {
    return plansCatalogCache;
  }

  const stripe = getStripe();
  const rows = envPlanRows();
  const resolvedIds = [];

  if (stripe) {
    for (const row of rows) {
      const pid = await resolveToPriceId(stripe, row.rawId);
      if (pid) resolvedIds.push({ ...row, priceId: pid });
    }
  } else {
    for (const row of rows) {
      const raw = String(row.rawId || '').trim();
      if (raw.startsWith('price_')) resolvedIds.push({ ...row, priceId: raw });
    }
  }

  const proPriceIds = [];
  const proRaw = [
    process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_PRO_PRICE_IDS,
    process.env.STRIPE_PRICE_ID_2,
  ]
    .filter(Boolean)
    .flatMap((x) => String(x).split(','))
    .map((x) => x.trim())
    .filter(Boolean);

  for (const raw of proRaw) {
    if (raw.startsWith('price_')) proPriceIds.push(raw);
    else if (stripe) {
      const pid = await resolveToPriceId(stripe, raw);
      if (pid) proPriceIds.push(pid);
    }
  }

  const seen = new Set();
  const plans = [];
  let n = 0;

  for (const row of resolvedIds) {
    const { priceId, label } = row;
    if (!priceId || seen.has(priceId)) continue;
    seen.add(priceId);
    n += 1;
    const defaultLabel = n === 1 ? 'Paket 1' : `Paket ${n}`;
    const planLabel = ((label || defaultLabel).trim() || defaultLabel).slice(0, 80);
    const planKey = inferPlanKey(priceId, planLabel, proPriceIds, n);

    let displayAmount = null;
    let currency = 'TRY';
    let interval = 'month';
    let intervalLabel = 'ay';

    if (stripe) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        if (price.unit_amount != null && Number.isFinite(price.unit_amount)) {
          displayAmount = Math.round(price.unit_amount / 100);
        }
        currency = (price.currency || 'try').toUpperCase();
        interval = price.recurring?.interval || 'month';
        intervalLabel = interval === 'year' ? 'yıl' : 'ay';
      } catch (e) {
        console.warn('[stripe] prices.retrieve failed', { priceId, message: e?.message });
      }
    }

    plans.push({
      priceId,
      label: planLabel,
      planKey,
      displayAmount,
      displayPrice: displayAmount != null ? formatTryAmount(displayAmount, currency) : null,
      currency,
      interval,
      intervalLabel,
    });
  }

  plansCatalogCache = plans;
  plansCatalogCacheAt = now;
  return plans;
}

async function getPublicPlansCatalog() {
  return buildPlansFromEnv();
}

/** Checkout / allowed price list — Stripe’dan çözülmüş price_ id’leri */
async function resolveCheckoutPlans() {
  const plans = await buildPlansFromEnv();
  return plans.map((p) => ({ priceId: p.priceId, label: p.label }));
}

async function resolveDefaultPriceId() {
  const plans = await resolveCheckoutPlans();
  return plans[0]?.priceId || '';
}

function resolveProPriceIds() {
  const ids = [
    process.env.STRIPE_PRO_PRICE_ID,
    process.env.STRIPE_PRO_PRICE_IDS,
    process.env.STRIPE_PRICE_ID_2,
  ]
    .filter(Boolean)
    .flatMap((x) => String(x).split(','))
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((id) => id.startsWith('price_'));

  if (plansCatalogCache) {
    for (const p of plansCatalogCache) {
      if (p.planKey === 'pro' && p.priceId) ids.push(p.priceId);
    }
  }

  return Array.from(new Set(ids));
}

function resolveFrontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** @deprecated use getPublicPlansCatalog */
function resolvePublicPlans() {
  return buildPlansFromEnv();
}

/** @deprecated */
async function enrichPlansWithStripePrices(plans) {
  return plans;
}

module.exports = {
  getStripe,
  resolveDefaultPriceId,
  resolveCheckoutPlans,
  resolveFrontendBaseUrl,
  resolveProPriceIds,
  resolvePublicPlans,
  enrichPlansWithStripePrices,
  getPublicPlansCatalog,
  buildPlansFromEnv,
  formatTryAmount,
  resolveToPriceId,
};

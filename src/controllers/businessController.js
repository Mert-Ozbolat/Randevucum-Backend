const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { syncBusinessReviewStats } = require('../utils/reviewStats');
const { ROLES, SUBSCRIPTION_STATUS } = require('../config/constants');
const {
  AREAS,
  PROFESSIONS_BY_AREA,
  PROFESSION_TO_BUSINESS_TYPE,
} = require('../config/areaProfessionData');
const { loadSetupContext, syncBusinessPublicActivation } = require('../utils/businessSetup');
const { normalizePhoneForDatabase } = require('../utils/phone');
const { normalizeExceptionDays } = require('../utils/availabilityExceptions');

/**
 * POST /business - Create business (BusinessOwner only)
 */
exports.createBusiness = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'Only business owners can create a business.');
  }
  const ownerId = req.user.role === ROLES.SUPER_ADMIN ? req.body.ownerId || req.user._id : req.user._id;

  // businessType UI'dan gelmeyebilir; profession'a göre türet.
  const profession = req.body.profession;
  if (!req.body.businessType && profession) {
    req.body.businessType = PROFESSION_TO_BUSINESS_TYPE[profession] || 'other';
  }

  const payload = { ...req.body, ownerId, isActive: false };
  if (payload.phone !== undefined) {
    const normalized = normalizePhoneForDatabase(payload.phone, { emptyValue: '' });
    if (normalized === null) {
      return error(res, 400, 'Geçerli bir işletme telefon numarası girin.');
    }
    payload.phone = normalized || '';
  }

  const business = await Business.create(payload);

  const trialDays = Math.max(1, parseInt(process.env.BUSINESS_TRIAL_DAYS || '30', 10) || 30);
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + trialDays);
  await Subscription.create({
    businessId: business._id,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    planKey: 'pro',
    isTrial: true,
    source: 'trial',
    startDate,
    endDate,
  });

  return success(res, 201, business, 'Business created successfully.');
});

/**
 * PUT /business/:id - Update business
 */
exports.updateBusiness = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const business = await Business.findById(id);
  if (!business) {
    return error(res, 404, 'Business not found.');
  }
  if (req.user.role !== ROLES.SUPER_ADMIN && business.ownerId.toString() !== req.user._id.toString()) {
    return error(res, 403, 'You do not own this business.');
  }

  const allowed = [
    'name',
    'area',
    'profession',
    'mainCategory',
    'subCategory',
    'businessType',
    'address',
    'location',
    'phone',
    'email',
    'description',
    'imageUrl',
    'promoVideoUrl',
    'promoVideoCaption',
    'workingHours',
    'breakTimes',
    'closedDays',
    'workingHoursConfigured',
  ];
  if (req.user.role === ROLES.SUPER_ADMIN && req.body.isActive !== undefined) {
    allowed.push('isActive');
  }
  if (req.body.phone !== undefined) {
    const normalized = normalizePhoneForDatabase(req.body.phone, { emptyValue: '' });
    if (normalized === null) {
      return error(res, 400, 'Geçerli bir işletme telefon numarası girin.');
    }
    business.phone = normalized || '';
  }

  allowed.forEach((key) => {
    if (key === 'phone' || req.body[key] === undefined) return;
    business[key] = req.body[key];
  });
  if (req.body.allowConcurrentBookings !== undefined) {
    business.allowConcurrentBookings = Boolean(req.body.allowConcurrentBookings);
  }
  if (req.body.concurrentBookingLimit !== undefined) {
    const n = parseInt(req.body.concurrentBookingLimit, 10);
    business.concurrentBookingLimit = Math.min(50, Math.max(2, Number.isFinite(n) ? n : 2));
  }
  if (req.body.workingHours !== undefined) {
    business.workingHoursConfigured = true;
  }
  if (req.body.closedDays !== undefined) {
    business.closedDays = normalizeExceptionDays(req.body.closedDays) || [];
  }

  if (!business.businessType && business.profession) {
    business.businessType =
      PROFESSION_TO_BUSINESS_TYPE[business.profession] || 'other';
  }

  await business.save();
  const activation = await syncBusinessPublicActivation(business._id);
  const payload = business.toObject ? business.toObject() : business;
  return success(
    res,
    200,
    { ...payload, setup: activation },
    activation?.isActive
      ? 'İşletme güncellendi ve müşterilere açıldı.'
      : 'İşletme güncellendi. Yayına almak için kurulum adımlarını tamamlayın.'
  );
});

/**
 * GET /business/:id - Get single business (public or owner)
 */
exports.getBusiness = asyncHandler(async (req, res) => {
  await syncBusinessReviewStats(req.params.id);
  const business = await Business.findById(req.params.id)
    .populate('ownerId', 'firstName lastName email');
  if (!business) {
    return error(res, 404, 'Business not found.');
  }
  const isOwner =
    req.user &&
    (req.user.role === ROLES.SUPER_ADMIN ||
      business.ownerId._id?.toString() === req.user._id.toString() ||
      business.ownerId.toString() === req.user._id.toString());
  if (!business.isActive && !isOwner) {
    return error(res, 404, 'İşletme henüz yayında değil.');
  }
  return success(res, 200, business, 'OK');
});

/**
 * GET /business/setup-status — İşletme sahibi kurulum + yayın durumu
 */
exports.getSetupStatus = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    return error(res, 403, 'Forbidden.');
  }
  const filter =
    req.user.role === ROLES.SUPER_ADMIN && req.query.businessId
      ? { _id: req.query.businessId }
      : { ownerId: req.user._id };
  const business = await Business.findOne(filter).sort({ createdAt: -1 }).lean();
  if (!business) {
    return success(
      res,
      200,
      {
        hasBusiness: false,
        isActive: false,
        setupComplete: false,
        percent: 0,
        completed: 0,
        total: 4,
        steps: { profile: false, services: false, staff: false, hours: false },
      },
      'OK'
    );
  }
  const ctx = await loadSetupContext(business._id);
  await syncBusinessPublicActivation(business._id);
  const refreshed = await Business.findById(business._id).select('isActive').lean();
  return success(
    res,
    200,
    {
      hasBusiness: true,
      businessId: String(business._id),
      isActive: Boolean(refreshed?.isActive),
      setupComplete: ctx.setup.isComplete,
      percent: ctx.setup.percent,
      completed: ctx.setup.completed,
      total: ctx.setup.total,
      steps: ctx.setup.steps,
    },
    'OK'
  );
});

/**
 * GET /business - List businesses (filter by type, for customers or admin)
 */
exports.listBusinesses = asyncHandler(async (req, res) => {
  const { businessType, ownerId, isActive, area, profession } = req.query;
  const filter = {};
  if (businessType) filter.businessType = businessType;

  // legacy uyumluluk: area/profession yoksa mainCategory/subCategory ile de eşleştir
  const and = [];
  if (area) {
    and.push({ $or: [{ area }, { mainCategory: area }] });
  }
  if (profession) {
    and.push({ $or: [{ profession }, { subCategory: profession }] });
  }
  if (and.length) filter.$and = and;

  const listMineOnly =
    req.query.mine === 'true' ||
    req.query.mine === '1' ||
    req.query.scope === 'mine';

  if (listMineOnly && req.user?.role === ROLES.BUSINESS_OWNER) {
    filter.ownerId = req.user._id;
  } else if (ownerId) {
    filter.ownerId = ownerId;
  } else if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  } else {
    // Public catalog: all active businesses (including when a business owner browses /business)
    filter.isActive = true;
  }

  const businesses = await Business.find(filter)
    .populate('ownerId', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();
  return success(res, 200, businesses, 'OK');
});

/**
 * GET /business/discover — Keşfet reels (promo videosu olan aktif işletmeler)
 */
exports.listDiscoverVideos = asyncHandler(async (_req, res) => {
  const businesses = await Business.find({
    isActive: true,
    promoVideoUrl: { $exists: true, $nin: ['', null] },
  })
    .select(
      'name businessType description imageUrl address averageRating reviewCount promoVideoUrl promoVideoCaption createdAt updatedAt'
    )
    .sort({ updatedAt: -1 })
    .lean();

  const data = businesses.filter((b) => String(b.promoVideoUrl || '').trim());
  return success(res, 200, data, 'OK');
});

/**
 * GET /business/home-slider-ads — Ücretli ana sayfa slider reklamları (herkese açık)
 */
exports.getHomeSliderAds = asyncHandler(async (_req, res) => {
  const now = new Date();
  const businesses = await Business.find({
    isActive: true,
    'homeSliderPromo.paidUntil': { $gt: now },
  })
    .select('name homeSliderPromo')
    .sort({ updatedAt: -1 })
    .lean();

  const data = businesses
    .map((b) => {
      const promo = b.homeSliderPromo || {};
      const imageUrl = (promo.imageUrl || '').trim();
      if (!imageUrl) return null;
      return {
        businessId: b._id.toString(),
        headline: (promo.headline || '').trim() || b.name,
        subline: (promo.subline || '').trim() || undefined,
        imageUrl,
        hrefPath: `/business/${b._id}`,
      };
    })
    .filter(Boolean);

  return success(res, 200, data, 'OK');
});

/**
 * PUT /business/:id/home-slider-promo — Sadece süresi olan işletme içerik güncelleyebilir
 */
exports.updateHomeSliderPromo = asyncHandler(async (req, res) => {
  const business = req.business;
  if (!business) {
    return error(res, 404, 'Business not found.');
  }
  const now = new Date();
  const paidUntil = business.homeSliderPromo?.paidUntil;
  if (!paidUntil || paidUntil <= now) {
    return error(res, 403, 'Ana sayfa reklam süreniz yok veya dolmuş. Önce paketi satın alın.');
  }

  const { headline, subline, imageUrl } = req.body;
  if (!business.homeSliderPromo) business.homeSliderPromo = {};
  if (headline !== undefined) business.homeSliderPromo.headline = String(headline).trim().slice(0, 120);
  if (subline !== undefined) business.homeSliderPromo.subline = String(subline).trim().slice(0, 200);
  if (imageUrl !== undefined) {
    const s = String(imageUrl).trim();
    /** Base64 ~%33 büyür; ~5MB dosya için güvenli üst sınır */
    const MAX_SLIDER_IMAGE_CHARS = 12 * 1024 * 1024;
    if (s.length > MAX_SLIDER_IMAGE_CHARS) {
      return error(res, 400, 'Görsel verisi çok büyük (maks. yaklaşık 5MB dosya).');
    }
    business.homeSliderPromo.imageUrl = s;
  }

  await business.save();
  return success(res, 200, business.homeSliderPromo, 'Slider reklamı güncellendi.');
});

/**
 * POST /business/:id/home-slider-promo/purchase — Demo: 7 gün slider süresi ekler (üretimde Stripe ile değiştirin)
 */
exports.purchaseHomeSliderPromo = asyncHandler(async (req, res) => {
  const business = req.business;
  if (!business) {
    return error(res, 404, 'Business not found.');
  }

  const defaultDays = Math.max(1, parseInt(process.env.SLIDER_PROMO_DAYS || '7', 10) || 7);
  const days = Math.min(365, Math.max(1, parseInt(req.body.days || String(defaultDays), 10) || defaultDays));
  const now = new Date();
  const currentEnd = business.homeSliderPromo?.paidUntil;
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  const paidUntil = new Date(base);
  paidUntil.setDate(paidUntil.getDate() + days);

  if (!business.homeSliderPromo) business.homeSliderPromo = {};
  business.homeSliderPromo.paidUntil = paidUntil;

  await business.save();
  return success(
    res,
    200,
    { paidUntil: business.homeSliderPromo.paidUntil, daysAdded: days },
    `Ana sayfa slider süresi ${days} gün uzatıldı (demo ödeme).`
  );
});

// GET /api/areas
exports.listAreas = asyncHandler(async (_req, res) => {
  return success(res, 200, AREAS, 'OK');
});

// GET /api/professions?area=Sağlık
exports.listProfessions = asyncHandler(async (req, res) => {
  const { area } = req.query;
  if (!area) {
    return error(res, 400, 'area is required');
  }
  const professions = PROFESSIONS_BY_AREA[area] || [];
  return success(res, 200, professions, 'OK');
});

// GET /api/businesses?area=Sağlık&profession=Psikolog
exports.listBusinessesByAreaProfession = asyncHandler(async (req, res) => {
  const { area, profession, isActive } = req.query;
  const filter = {};
  const and = [];
  if (area) {
    and.push({ $or: [{ area }, { mainCategory: area }] });
  }
  if (profession) {
    and.push({ $or: [{ profession }, { subCategory: profession }] });
  }
  if (and.length) filter.$and = and;

  const listMineOnly =
    req.query.mine === 'true' ||
    req.query.mine === '1' ||
    req.query.scope === 'mine';

  if (listMineOnly && req.user?.role === ROLES.BUSINESS_OWNER) {
    filter.ownerId = req.user._id;
  } else if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  } else {
    filter.isActive = true;
  }

  const businesses = await Business.find(filter)
    .populate('ownerId', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();
  return success(res, 200, businesses, 'OK');
});

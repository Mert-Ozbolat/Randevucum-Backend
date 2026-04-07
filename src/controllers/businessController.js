const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES, SUBSCRIPTION_STATUS } = require('../config/constants');
const {
  AREAS,
  PROFESSIONS_BY_AREA,
  PROFESSION_TO_BUSINESS_TYPE,
} = require('../config/areaProfessionData');

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

  const business = await Business.create({
    ...req.body,
    ownerId,
  });

  const trialDays = Math.max(1, parseInt(process.env.BUSINESS_TRIAL_DAYS || '90', 10) || 90);
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + trialDays);
  await Subscription.create({
    businessId: business._id,
    status: SUBSCRIPTION_STATUS.ACTIVE,
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
    'workingHours', 'breakTimes', 'isActive',
  ];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) business[key] = req.body[key];
  });

  if (!business.businessType && business.profession) {
    business.businessType =
      PROFESSION_TO_BUSINESS_TYPE[business.profession] || 'other';
  }

  await business.save();
  return success(res, 200, business, 'Business updated successfully.');
});

/**
 * GET /business/:id - Get single business (public or owner)
 */
exports.getBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id)
    .populate('ownerId', 'firstName lastName email');
  if (!business) {
    return error(res, 404, 'Business not found.');
  }
  return success(res, 200, business, 'OK');
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

  if (ownerId) filter.ownerId = ownerId;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  if (req.user?.role === ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    filter.ownerId = req.user._id;
  }

  const businesses = await Business.find(filter)
    .populate('ownerId', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();
  return success(res, 200, businesses, 'OK');
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
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  if (req.user?.role === ROLES.BUSINESS_OWNER && req.user.role !== ROLES.SUPER_ADMIN) {
    filter.ownerId = req.user._id;
  }

  const businesses = await Business.find(filter)
    .populate('ownerId', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();
  return success(res, 200, businesses, 'OK');
});

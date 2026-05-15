const Favorite = require('../models/Favorite');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

const businessListFields =
  'name businessType area profession mainCategory subCategory address description imageUrl averageRating reviewCount createdAt';

/**
 * GET /favorites/me — Giriş yapmış kullanıcının favori işletmeleri
 */
exports.listMyFavorites = asyncHandler(async (req, res) => {
  const rows = await Favorite.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: 'businessId',
      select: businessListFields,
      match: { isActive: { $ne: false } },
    })
    .lean();

  const businesses = rows
    .filter((r) => r.businessId)
    .map((r) => ({
      ...r.businessId,
      rating: r.businessId.averageRating ?? null,
      favoritedAt: r.createdAt,
    }));

  return success(res, 200, businesses, 'OK');
});

/**
 * GET /favorites/ids — Sadece favori businessId listesi (kartlarda durum için)
 */
exports.listMyFavoriteIds = asyncHandler(async (req, res) => {
  const rows = await Favorite.find({ userId: req.user._id }).select('businessId').lean();
  const ids = rows.map((r) => String(r.businessId));
  return success(res, 200, { businessIds: ids }, 'OK');
});

/**
 * POST /favorites — body: { businessId }
 */
exports.addFavorite = asyncHandler(async (req, res) => {
  const { businessId } = req.body;
  const business = await Business.findById(businessId).select('_id isActive').lean();
  if (!business || business.isActive === false) {
    return error(res, 404, 'İşletme bulunamadı.');
  }

  const existing = await Favorite.findOne({ userId: req.user._id, businessId });
  if (existing) {
    return success(res, 200, { businessId, favorited: true }, 'Zaten favorilerde.');
  }

  await Favorite.create({ userId: req.user._id, businessId });
  return success(res, 201, { businessId, favorited: true }, 'Favorilere eklendi.');
});

/**
 * DELETE /favorites/:businessId
 */
exports.removeFavorite = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  await Favorite.deleteOne({ userId: req.user._id, businessId });
  return success(res, 200, { businessId, favorited: false }, 'Favorilerden kaldırıldı.');
});

/**
 * POST /favorites/toggle — body: { businessId }
 */
exports.toggleFavorite = asyncHandler(async (req, res) => {
  const { businessId } = req.body;
  const business = await Business.findById(businessId).select('_id isActive').lean();
  if (!business || business.isActive === false) {
    return error(res, 404, 'İşletme bulunamadı.');
  }

  const existing = await Favorite.findOne({ userId: req.user._id, businessId });
  if (existing) {
    await Favorite.deleteOne({ _id: existing._id });
    return success(res, 200, { businessId, favorited: false }, 'Favorilerden kaldırıldı.');
  }

  await Favorite.create({ userId: req.user._id, businessId });
  return success(res, 200, { businessId, favorited: true }, 'Favorilere eklendi.');
});

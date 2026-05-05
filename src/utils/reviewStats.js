const mongoose = require('mongoose');
const Review = require('../models/Review');
const Business = require('../models/Business');

/**
 * İşletmenin tüm yorumlarından ortalama ve adet hesaplar, Business kaydına yazar.
 */
async function syncBusinessReviewStats(businessId) {
  const raw =
    typeof businessId === 'string' ? businessId : businessId?.toString?.();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return;

  const bid = new mongoose.Types.ObjectId(raw);
  const agg = await Review.aggregate([
    { $match: { businessId: bid } },
    {
      $group: {
        _id: null,
        avg: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  if (!agg.length) {
    await Business.updateOne({ _id: bid }, { $set: { averageRating: null, reviewCount: 0 } });
    return;
  }

  const avgRounded = Math.round(agg[0].avg * 10) / 10;
  await Business.updateOne(
    { _id: bid },
    { $set: { averageRating: avgRounded, reviewCount: agg[0].count } }
  );
}

module.exports = { syncBusinessReviewStats };

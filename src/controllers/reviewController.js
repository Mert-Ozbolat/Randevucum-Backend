const Review = require('../models/Review');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');

exports.createOrUpdateReview = asyncHandler(async (req, res) => {
  const { businessId, rating, comment } = req.body;
  const customerId = req.user._id;

  const business = await Business.findById(businessId).lean();
  if (!business) return error(res, 404, 'Business not found.');

  // Upsert: aynı kullanıcı aynı işletmeye tekrar yazınca güncellensin.
  const review = await Review.findOneAndUpdate(
    { businessId, customerId },
    { $set: { businessId, customerId, rating, comment } },
    { upsert: true, new: true }
  ).lean();

  return success(res, 200, review, 'Review saved.');
});

exports.getReviewsByBusiness = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const reviews = await Review.find({ businessId })
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();

  return success(res, 200, reviews, 'OK');
});


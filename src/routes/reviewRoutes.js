const express = require('express');
const reviewController = require('../controllers/reviewController');
const { protect } = require('../middleware/auth');
const {
  createReviewRules,
  businessIdParamRules,
  validate,
} = require('../validators/reviewValidator');

const router = express.Router();

// POST /reviews - create/update review (customer)
router.post('/', protect, createReviewRules(), validate, reviewController.createOrUpdateReview);

// GET /reviews/business/:businessId - list reviews
router.get(
  '/business/:businessId',
  businessIdParamRules(),
  validate,
  reviewController.getReviewsByBusiness
);

module.exports = router;


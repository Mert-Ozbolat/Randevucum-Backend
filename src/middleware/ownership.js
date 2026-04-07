const Business = require('../models/Business');
const { error } = require('../utils/response');
const { ROLES } = require('../config/constants');

/**
 * Ensure the authenticated user owns the business (or is SuperAdmin).
 * Use after protect. Sets req.business and req.businessId.
 * Expects req.params.businessId or req.params.id (for business route).
 */
const requireBusinessOwnership = async (req, res, next) => {
  try {
    if (req.user.role === ROLES.SUPER_ADMIN) {
      const businessId = req.params.businessId || req.params.id;
      if (businessId) {
        const business = await Business.findById(businessId);
        if (business) {
          req.business = business;
          req.businessId = business._id;
        }
      }
      return next();
    }

    if (req.user.role !== ROLES.BUSINESS_OWNER) {
      return error(res, 403, 'Only business owners can access this resource.');
    }

    const businessId = req.params.businessId || req.params.id || req.body.businessId;
    if (!businessId) {
      return error(res, 400, 'Business ID is required.');
    }

    const business = await Business.findOne({
      _id: businessId,
      ownerId: req.user._id,
    });

    if (!business) {
      return error(res, 403, 'You do not own this business.');
    }

    req.business = business;
    req.businessId = business._id;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireBusinessOwnership };

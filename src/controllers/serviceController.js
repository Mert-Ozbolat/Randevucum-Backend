const Service = require('../models/Service');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES } = require('../config/constants');

const canManageService = (req, business) => {
  if (req.user.role === ROLES.SUPER_ADMIN) return true;
  return business.ownerId.toString() === req.user._id.toString();
};

/**
 * POST /services - Create service (business owner; businessId in body)
 */
exports.createService = asyncHandler(async (req, res) => {
  const { businessId, ...data } = req.body;
  const bid = businessId || req.businessId;
  if (!bid) return error(res, 400, 'Business ID is required.');

  const business = await Business.findById(bid);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageService(req, business)) return error(res, 403, 'You do not own this business.');

  const service = await Service.create({ ...data, businessId: bid });
  return success(res, 201, service, 'Service created successfully.');
});

/**
 * PUT /services/:id - Update service
 */
exports.updateService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id).populate('businessId');
  if (!service) return error(res, 404, 'Service not found.');
  const business = await Business.findById(service.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageService(req, business)) return error(res, 403, 'You do not own this business.');

  const allowed = ['name', 'description', 'durationMinutes', 'price', 'currency', 'isActive'];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) service[key] = req.body[key];
  });
  await service.save();
  return success(res, 200, service, 'Service updated successfully.');
});

/**
 * DELETE /services/:id
 */
exports.deleteService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);
  if (!service) return error(res, 404, 'Service not found.');
  const business = await Business.findById(service.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageService(req, business)) return error(res, 403, 'You do not own this business.');

  await Service.findByIdAndDelete(req.params.id);
  return success(res, 200, null, 'Service deleted successfully.');
});

/**
 * GET /services/business/:businessId - List services for a business (public)
 */
exports.getServicesByBusiness = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const onlyActive = req.query.active !== 'false';
  const filter = { businessId };
  if (onlyActive) filter.isActive = true;

  const services = await Service.find(filter).sort({ name: 1 }).lean();
  return success(res, 200, services, 'OK');
});

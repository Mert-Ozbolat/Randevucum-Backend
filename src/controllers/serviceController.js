const mongoose = require('mongoose');
const Service = require('../models/Service');
const Business = require('../models/Business');
const Staff = require('../models/Staff');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES } = require('../config/constants');

/** İşletmeye ait aktif personel ID'leri; geçersiz veya başka işletme → null */
async function validateStaffIdsForBusiness(businessId, staffIdsInput) {
  if (!Array.isArray(staffIdsInput)) return null;
  const unique = [...new Set(staffIdsInput.map((id) => String(id)))];
  if (unique.length === 0) return [];
  const n = await Staff.countDocuments({
    businessId,
    isActive: true,
    _id: { $in: unique.map((id) => new mongoose.Types.ObjectId(id)) },
  });
  if (n !== unique.length) return null;
  return unique;
}

const canManageService = (req, business) => {
  if (req.user.role === ROLES.SUPER_ADMIN) return true;
  return business.ownerId.toString() === req.user._id.toString();
};

/**
 * POST /services - Create service (business owner; businessId in body)
 */
exports.createService = asyncHandler(async (req, res) => {
  const { businessId, staffIds: staffIdsBody, ...data } = req.body;
  const bid = businessId || req.businessId;
  if (!bid) return error(res, 400, 'Business ID is required.');

  const business = await Business.findById(bid);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageService(req, business)) return error(res, 403, 'You do not own this business.');

  const min = data.priceMin != null ? Number(data.priceMin) : null;
  const max = data.priceMax != null ? Number(data.priceMax) : null;
  if (min != null && max != null && min > max) {
    return error(res, 400, 'Minimum fiyat, maksimum fiyattan büyük olamaz.');
  }

  if (data.priceMin != null || data.priceMax != null) {
    data.price = null;
  }

  let staffIds = [];
  if (staffIdsBody !== undefined) {
    const ok = await validateStaffIdsForBusiness(bid, staffIdsBody);
    if (ok === null) return error(res, 400, 'Geçersiz personel seçimi (işletmenize ait aktif personel seçin).');
    staffIds = ok;
  }

  const service = await Service.create({ ...data, businessId: bid, staffIds });
  return success(res, 201, service, 'Service created successfully.');
});

/**
 * PUT /services/:id - Update service
 */
exports.updateService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id).populate('businessId');
  if (!service) return error(res, 404, 'Service not found.');
  const business = await Business.findById(service.businessId?._id || service.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageService(req, business)) return error(res, 403, 'You do not own this business.');

  const minIn = req.body.priceMin;
  const maxIn = req.body.priceMax;
  if (minIn !== undefined && maxIn !== undefined && minIn !== '' && maxIn !== '') {
    const min = Number(minIn);
    const max = Number(maxIn);
    if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) {
      return error(res, 400, 'Minimum fiyat, maksimum fiyattan büyük olamaz.');
    }
  }

  if (req.body.staffIds !== undefined) {
    const bid = service.businessId?._id || service.businessId;
    const ok = await validateStaffIdsForBusiness(bid, req.body.staffIds);
    if (ok === null) return error(res, 400, 'Geçersiz personel seçimi (işletmenize ait aktif personel seçin).');
    service.staffIds = ok;
  }

  const allowed = [
    'name',
    'description',
    'durationMinutes',
    'price',
    'priceMin',
    'priceMax',
    'currency',
    'isActive',
  ];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) service[key] = req.body[key];
  });
  if (req.body.priceMin !== undefined || req.body.priceMax !== undefined) {
    service.price = null;
  }
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

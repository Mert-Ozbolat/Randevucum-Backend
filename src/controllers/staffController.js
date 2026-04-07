const Staff = require('../models/Staff');
const Business = require('../models/Business');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES } = require('../config/constants');

const canManageStaff = (req, business) => {
  if (req.user.role === ROLES.SUPER_ADMIN) return true;
  return business.ownerId.toString() === req.user._id.toString();
};

/**
 * POST /staff - Create staff (businessId in body)
 */
exports.createStaff = asyncHandler(async (req, res) => {
  const { businessId, ...data } = req.body;
  const bid = businessId || req.businessId;
  if (!bid) return error(res, 400, 'Business ID is required.');

  const business = await Business.findById(bid);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageStaff(req, business)) return error(res, 403, 'You do not own this business.');

  const staff = await Staff.create({ ...data, businessId: bid });
  return success(res, 201, staff, 'Staff created successfully.');
});

/**
 * PUT /staff/:id - Update staff
 */
exports.updateStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) return error(res, 404, 'Staff not found.');
  const business = await Business.findById(staff.businessId);
  if (!business) return error(res, 404, 'Business not found.');
  if (!canManageStaff(req, business)) return error(res, 403, 'You do not own this business.');

  const allowed = ['name', 'title', 'phone', 'email', 'serviceIds', 'workingHours', 'isActive'];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) staff[key] = req.body[key];
  });
  await staff.save();
  return success(res, 200, staff, 'Staff updated successfully.');
});

/**
 * GET /staff/business/:businessId - List staff for a business
 */
exports.getStaffByBusiness = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const onlyActive = req.query.active !== 'false';
  const filter = { businessId };
  if (onlyActive) filter.isActive = true;

  const staff = await Staff.find(filter).populate('serviceIds', 'name durationMinutes').sort({ name: 1 }).lean();
  return success(res, 200, staff, 'OK');
});

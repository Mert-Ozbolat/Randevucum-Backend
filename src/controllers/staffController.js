const Staff = require('../models/Staff');
const Business = require('../models/Business');
const User = require('../models/User');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES } = require('../config/constants');
const { getStaffQuota } = require('../utils/subscriptionLimits');
const { syncBusinessPublicActivation } = require('../utils/businessSetup');
const { normalizeExceptionDays } = require('../utils/availabilityExceptions');

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

  if (req.user.role !== ROLES.SUPER_ADMIN) {
    const quota = await getStaffQuota(bid);
    if (!quota.canAdd) {
      return error(
        res,
        403,
        quota.planKey === 'pro'
          ? 'Personel eklenemedi.'
          : `Standart pakette en fazla ${quota.limit} personel ekleyebilirsiniz. Pro pakete geçerek sınırsız personel ekleyin.`
      );
    }
  }

  if (data.email !== undefined && String(data.email).trim() === '') delete data.email;
  if (data.phone !== undefined && String(data.phone).trim() === '') delete data.phone;

  const { linkUserEmail, ...createData } = data;
  const staff = await Staff.create({ ...createData, businessId: bid });

  let message = 'Personel kaydedildi.';
  if (linkUserEmail !== undefined) {
    const email = String(linkUserEmail).trim().toLowerCase();
    if (email) {
      const u = await User.findOne({ email }).select('_id').lean();
      if (u) {
        staff.userId = u._id;
        await staff.save();
        message = 'Personel kaydedildi; platform hesabı eşleştirildi.';
      } else {
        message =
          'Personel kaydedildi. Bu e-posta ile kayıtlı kullanıcı yok; hesap eşleştirmesi yapılmadı. İşletme panelinden personeli yönetmeye devam edebilir, çalışan kayıt olduktan sonra e-postayı tekrar kaydedebilirsiniz.';
      }
    }
  }

  await syncBusinessPublicActivation(bid);
  return success(res, 201, staff, message);
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

  const allowed = [
    'name',
    'title',
    'phone',
    'email',
    'imageUrl',
    'serviceIds',
    'workingHours',
    'leaveDays',
    'isActive',
  ];
  allowed.forEach((key) => {
    if (req.body[key] === undefined) return;
    if ((key === 'email' || key === 'phone') && String(req.body[key]).trim() === '') {
      staff[key] = '';
      return;
    }
    staff[key] = req.body[key];
  });

  if (req.body.canViewOwnReservations !== undefined) {
    staff.canViewOwnReservations = Boolean(req.body.canViewOwnReservations);
  }
  if (req.body.leaveDays !== undefined) {
    staff.leaveDays = normalizeExceptionDays(req.body.leaveDays) || [];
  }

  let message = 'Güncellendi.';
  if (req.body.linkUserEmail !== undefined) {
    const raw = String(req.body.linkUserEmail).trim().toLowerCase();
    if (!raw) {
      staff.userId = null;
    } else {
      const u = await User.findOne({ email: raw }).select('_id').lean();
      if (u) {
        staff.userId = u._id;
      } else {
        message =
          'Bu e-posta ile kayıtlı kullanıcı yok; hesap eşleştirmesi değişmedi. Diğer bilgiler kaydedildi. İşletme panelinden tüm personeli yönetmeye devam edebilirsiniz; çalışan kayıt olduktan sonra doğru e-postayı tekrar deneyin.';
      }
    }
  }

  await staff.save();
  await syncBusinessPublicActivation(staff.businessId);
  return success(res, 200, staff, message);
});

/**
 * GET /staff/me — Giriş yapan kullanıcının personel kayıtları (çoklu işletme olabilir)
 */
exports.getMyStaffProfile = asyncHandler(async (req, res) => {
  const list = await Staff.find({ userId: req.user._id, isActive: true })
    .populate('businessId', 'name')
    .sort({ name: 1 })
    .lean();
  return success(res, 200, list, 'OK');
});

/**
 * GET /staff/business/:businessId - List staff for a business
 */
exports.getStaffByBusiness = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const onlyActive = req.query.active !== 'false';
  const filter = { businessId };
  if (onlyActive) filter.isActive = true;

  const business = await Business.findById(businessId).select('ownerId').lean();
  const isOwner =
    req.user &&
    business &&
    (req.user.role === ROLES.SUPER_ADMIN ||
      business.ownerId.toString() === req.user._id.toString());

  let q = Staff.find(filter)
    .populate('serviceIds', 'name durationMinutes')
    .sort({ name: 1 });
  if (isOwner) {
    q = q.populate('userId', 'email firstName lastName');
  } else {
    q = q.select('-userId -canViewOwnReservations');
  }
  const staff = await q.lean();
  return success(res, 200, staff, 'OK');
});

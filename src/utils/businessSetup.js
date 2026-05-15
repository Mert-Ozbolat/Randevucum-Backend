const Business = require('../models/Business');
const Service = require('../models/Service');
const Staff = require('../models/Staff');

const DESCRIPTION_MIN_LEN = 8;

function hasProfileLocationDone(b) {
  const city = b.address?.city?.trim();
  const district = b.address?.district?.trim();
  const street = b.address?.street?.trim() ?? '';
  return !!(city || district || street.length >= 5);
}

function isProfileStepDone(b) {
  const descLen = b.description?.trim().length ?? 0;
  return !!(b.phone?.trim() && hasProfileLocationDone(b) && descLen >= DESCRIPTION_MIN_LEN);
}

function isServicesStepDone(servicesCount) {
  return servicesCount >= 1;
}

function isStaffStepDone(staffCount) {
  return staffCount >= 1;
}

function isWorkingHoursStepDone(b) {
  const wh = b.workingHours;
  if (!wh?.length) return false;
  return wh.some((d) => !d.isClosed);
}

function evaluateSetup(business, servicesCount, staffCount) {
  const steps = {
    profile: isProfileStepDone(business),
    services: isServicesStepDone(servicesCount),
    staff: isStaffStepDone(staffCount),
    hours: isWorkingHoursStepDone(business),
  };
  const completed = Object.values(steps).filter(Boolean).length;
  const total = 4;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const isComplete = completed === total;
  return { steps, completed, total, percent, isComplete };
}

async function loadSetupContext(businessId) {
  const business = await Business.findById(businessId).lean();
  if (!business) return null;
  const [servicesCount, staffCount] = await Promise.all([
    Service.countDocuments({ businessId }),
    Staff.countDocuments({ businessId }),
  ]);
  const setup = evaluateSetup(business, servicesCount, staffCount);
  return { business, servicesCount, staffCount, setup };
}

/**
 * Kurulum tamamsa isActive=true, değilse false (sahip manuel açamaz).
 */
async function syncBusinessPublicActivation(businessId) {
  const ctx = await loadSetupContext(businessId);
  if (!ctx) return null;

  const business = await Business.findById(businessId);
  if (!business) return null;

  const shouldBeActive = ctx.setup.isComplete;
  const changed = business.isActive !== shouldBeActive;
  if (changed) {
    business.isActive = shouldBeActive;
    await business.save();
  }

  return {
    businessId: String(businessId),
    isActive: business.isActive,
    setupComplete: ctx.setup.isComplete,
    percent: ctx.setup.percent,
    completed: ctx.setup.completed,
    total: ctx.setup.total,
    steps: ctx.setup.steps,
    changed,
  };
}

module.exports = {
  evaluateSetup,
  loadSetupContext,
  syncBusinessPublicActivation,
};

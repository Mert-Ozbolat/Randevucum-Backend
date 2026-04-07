// User roles
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  BUSINESS_OWNER: 'business_owner',
  CUSTOMER: 'customer',
};

// Business types
const BUSINESS_TYPES = {
  HAIR_SALON: 'hair_salon',
  DENTAL_CLINIC: 'dental_clinic',
  BEAUTY_CENTER: 'beauty_center',
  RESTAURANT: 'restaurant',
  OTHER: 'other',

  // New: subcategory slugs (main category -> subcategory UX)
  EYE_DOCTOR: 'eye_doctor',
  PHYSIOTHERAPIST: 'physiotherapist',
  PSYCHOLOGIST: 'psychologist',
  DIETITIAN: 'dietitian',
  AESTHETIC_CLINIC: 'aesthetic_clinic',
  LAB: 'lab',

  NAIL_SALON: 'nail_salon',
  LASH_BROW: 'lash_brow',
  LASER_EPILATION: 'laser_epilation',
  SKIN_CARE: 'skin_care',
  MASSAGE_SALON: 'massage_salon',

  AUTO_REPAIR: 'auto_repair',
  CAR_WASH: 'car_wash',
  TIRE_SHOP: 'tire_shop',
  AC_SERVICE: 'ac_service',
  BODY_PAINT: 'body_paint',
  AUTO_EXPERT: 'auto_expert',

  ELECTRICIAN: 'electrician',
  PLUMBER: 'plumber',
  AC_INSTALL_MAINT: 'ac_install_maint',
  SATELLITE_INTERNET_SETUP: 'satellite_internet_setup',
  CARPENTER: 'carpenter',
  PAINTER: 'painter',

  VETERINARIAN: 'veterinarian',
  PET_GROOMER: 'pet_groomer',
  PET_TRAINER: 'pet_trainer',
  PET_HOTEL: 'pet_hotel',
  PET_VACCINE_TRACKING: 'pet_vaccine_tracking',

  PRIVATE_TUTOR: 'private_tutor',
  DRIVING_SCHOOL: 'driving_school',
  LANGUAGE_COURSE: 'language_course',
  SOFTWARE_COURSE: 'software_course',
  PILATES_YOGA_INSTRUCTOR: 'pilates_yoga_instructor',

  BOAT_TOUR: 'boat_tour',
  DIVING_CENTER: 'diving_center',
  SPA_HAMAM: 'spa_hamam',
  RENT_A_CAR: 'rent_a_car',
  PHOTOGRAPHER: 'photographer',
  WEDDING_ORGANIZATION: 'wedding_organization',
};

// Subscription status
const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
};

// Reservation status
const RESERVATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
};

// Default slot interval in minutes
const SLOT_INTERVAL_MINUTES = 15;

module.exports = {
  ROLES,
  BUSINESS_TYPES,
  SUBSCRIPTION_STATUS,
  RESERVATION_STATUS,
  SLOT_INTERVAL_MINUTES,
};

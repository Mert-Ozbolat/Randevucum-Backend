const User = require('../models/User');
const { ROLES } = require('../config/constants');
const { normalizePhoneForDatabase } = require('./phone');

function splitGuestName(guestName) {
  const parts = String(guestName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'Misafir', lastName: '—' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0].slice(0, 80), lastName: '—' };
  }
  return {
    firstName: parts[0].slice(0, 80),
    lastName: parts.slice(1).join(' ').slice(0, 80),
  };
}

function guestEmailForPhone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '');
  return `guest+${digits}@randevucum.app`;
}

/**
 * Hızlı randevu: telefon ile mevcut müşteriyi bul veya hafif hesap oluştur.
 */
async function findOrCreateQuickBookingUser({ guestName, customerPhone }) {
  const e164 = normalizePhoneForDatabase(customerPhone);
  if (!e164) {
    return { ok: false, reason: 'invalid_phone' };
  }

  const { firstName, lastName } = splitGuestName(guestName);

  let user = await User.findOne({ phone: e164, role: ROLES.CUSTOMER })
    .sort({ createdAt: -1 })
    .exec();

  if (user) {
    if (guestName && String(guestName).trim()) {
      user.firstName = firstName;
      user.lastName = lastName;
      await user.save();
    }
    return { ok: true, user, created: false };
  }

  const email = guestEmailForPhone(e164);
  const existingByEmail = await User.findOne({ email });
  if (existingByEmail) {
    if (!existingByEmail.phone) {
      existingByEmail.phone = e164;
      await existingByEmail.save();
    }
    return { ok: true, user: existingByEmail, created: false };
  }

  user = await User.create({
    email,
    firstName,
    lastName,
    phone: e164,
    role: ROLES.CUSTOMER,
  });

  return { ok: true, user, created: true };
}

module.exports = {
  findOrCreateQuickBookingUser,
  splitGuestName,
};

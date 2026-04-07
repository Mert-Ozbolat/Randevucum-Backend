const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { ROLES } = require('../config/constants');

function getGoogleClient() {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) return null;
  return new OAuth2Client(id);
}

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const userObj = user.toObject ? user.toObject() : user;
  delete userObj.password;
  return success(res, statusCode, { user: userObj, token }, 'Authenticated successfully');
};

/**
 * POST /auth/register
 * body: email, password, firstName, lastName, phone?, role?
 */
exports.register = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone, role } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return error(res, 400, 'Email already registered.');
  }

  const allowedRoles = [ROLES.CUSTOMER, ROLES.BUSINESS_OWNER];
  const finalRole = role && allowedRoles.includes(role) ? role : ROLES.CUSTOMER;

  const user = await User.create({
    email: email.toLowerCase(),
    password,
    firstName,
    lastName,
    phone: phone || undefined,
    role: finalRole,
  });

  createSendToken(user, 201, res);
});

/**
 * POST /auth/login
 * body: email, password
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return error(res, 401, 'Invalid email or password.');
  }

  if (!user.password) {
    return error(res, 401, 'This account uses Google sign-in.');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return error(res, 401, 'Invalid email or password.');
  }

  if (!user.isActive) {
    return error(res, 401, 'Account is deactivated.');
  }

  createSendToken(user, 200, res);
});

/**
 * POST /auth/google
 * body: idToken (Google credential JWT), accountType? (customer | business_owner — required for brand-new users),
 *       firstName?, lastName?, phone?
 */
exports.googleAuth = asyncHandler(async (req, res) => {
  const client = getGoogleClient();
  if (!client) {
    return error(
      res,
      503,
      'Google sign-in is not configured on the API. Set GOOGLE_CLIENT_ID in backend/.env and restart the server.'
    );
  }

  const { idToken, accountType, firstName: bodyFirst, lastName: bodyLast, phone } = req.body;

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return error(res, 401, 'Invalid Google token.');
  }

  if (!payload?.email) {
    return error(res, 400, 'Google did not return an email address.');
  }
  if (payload.email_verified === false) {
    return error(res, 400, 'A verified Google email is required.');
  }

  const googleId = payload.sub;
  const email = payload.email.toLowerCase();
  const fromGoogleFirst = payload.given_name || '';
  const fromGoogleLast = payload.family_name || '';

  let user = await User.findOne({
    $or: [{ googleId }, { email }],
  }).select('+password');

  if (user) {
    if (user.googleId && user.googleId !== googleId) {
      return error(res, 400, 'This email is linked to a different Google account.');
    }
    if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }
    return createSendToken(user, 200, res);
  }

  if (!accountType || ![ROLES.CUSTOMER, ROLES.BUSINESS_OWNER].includes(accountType)) {
    return res.status(400).json({
      status: 'fail',
      message: 'Hesap türü seçmeniz gerekiyor.',
      code: 'ACCOUNT_TYPE_REQUIRED',
      data: {
        email,
        firstName: (bodyFirst || fromGoogleFirst || '').trim(),
        lastName: (bodyLast || fromGoogleLast || '').trim(),
      },
    });
  }

  const firstName = (bodyFirst || fromGoogleFirst || email.split('@')[0] || 'User').trim() || 'User';
  const lastName = (bodyLast || fromGoogleLast || '-').trim() || '-';

  const newUser = await User.create({
    email,
    googleId,
    firstName: firstName.slice(0, 80),
    lastName: lastName.slice(0, 80),
    phone: phone || undefined,
    role: accountType,
  });

  createSendToken(newUser, 201, res);
});

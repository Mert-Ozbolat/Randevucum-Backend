const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { getImageKit } = require('../config/imagekit');

/**
 * GET /upload/imagekit-auth
 * Client-side upload için imza ve token (JWT ile korunur).
 */
exports.imageKitAuth = asyncHandler(async (req, res) => {
  const ik = getImageKit();
  if (!ik) {
    return error(
      res,
      503,
      'ImageKit yapılandırılmadı. API .env içinde IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY ve IMAGEKIT_URL_ENDPOINT ayarlayın.'
    );
  }

  const auth = ik.getAuthenticationParameters();
  return success(res, 200, {
    token: auth.token,
    expire: auth.expire,
    signature: auth.signature,
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY.trim(),
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT.trim(),
  });
});

const ImageKit = require('imagekit');

let instance = null;

function normalizeEndpoint(endpoint) {
  const e = String(endpoint || '').trim();
  if (!e) return '';
  return e.endsWith('/') ? e : `${e}/`;
}

function getImageKit() {
  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
  const urlEndpoint = normalizeEndpoint(process.env.IMAGEKIT_URL_ENDPOINT);

  if (!publicKey || !privateKey || !urlEndpoint) {
    return null;
  }

  if (!instance) {
    instance = new ImageKit({
      publicKey,
      privateKey,
      urlEndpoint,
    });
  }
  return instance;
}

function isImageKitConfigured() {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY?.trim() &&
    process.env.IMAGEKIT_PRIVATE_KEY?.trim() &&
    normalizeEndpoint(process.env.IMAGEKIT_URL_ENDPOINT)
  );
}

module.exports = { getImageKit, isImageKitConfigured };

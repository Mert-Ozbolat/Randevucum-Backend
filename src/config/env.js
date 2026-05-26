/**
 * Ortam değişkeni doğrulama — production'da zayıf varsayılanları engeller.
 */
function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const warnings = [];
  const errors = [];

  if (!process.env.MONGODB_URI) {
    if (isProd) errors.push('MONGODB_URI is required in production.');
    else warnings.push('MONGODB_URI not set — using local default.');
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required.');
  } else if (jwtSecret.length < 32) {
    if (isProd) {
      errors.push('JWT_SECRET must be at least 32 characters in production.');
    } else {
      warnings.push('JWT_SECRET is shorter than 32 characters (ok for local dev only).');
    }
  }

  if (isProd && !process.env.JOBS_SECRET) {
    errors.push('JOBS_SECRET is required in production (protects /jobs/* endpoints).');
  }

  if (isProd) {
    const origins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '').trim();
    if (!origins) {
      warnings.push('CORS_ORIGINS or FRONTEND_URL not set — CORS will block browser requests.');
    }
  }

  warnings.forEach((w) => console.warn(`[env] ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`[env] ${e}`));
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }
}

module.exports = { validateEnv };

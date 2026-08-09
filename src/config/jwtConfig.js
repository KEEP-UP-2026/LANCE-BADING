// JWT secret validation for production safety

const DEFAULT_SECRETS = new Set([
  'default_jwt_secret_key_keep_up_2026',
  'super_secret_jwt_key_change_me_in_production',
  'change_me',
  'secret'
]);

function isTestMode() {
  return process.env.KEEPUP_TEST_MODE === 'true' || process.env.NODE_ENV === 'test';
}

function validateJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isTestMode()) {
    if (!secret) {
      process.env.JWT_SECRET = 'default_jwt_secret_key_keep_up_2026';
    }
    return process.env.JWT_SECRET;
  }

  if (!secret || secret.trim().length < 32) {
    const msg = 'JWT_SECRET is missing or too short (minimum 32 characters required outside test mode).';
    if (isProduction) {
      console.error(`FATAL: ${msg}`);
      process.exit(1);
    }
    console.warn(`WARNING: ${msg} Using development fallback. Set a strong JWT_SECRET before production.`);
    process.env.JWT_SECRET = secret && secret.trim() ? secret : 'default_jwt_secret_key_keep_up_2026';
  }

  if (isProduction && DEFAULT_SECRETS.has(secret)) {
    console.error('FATAL: JWT_SECRET must not use a known default value in production.');
    process.exit(1);
  }

  return process.env.JWT_SECRET;
}

module.exports = { validateJwtSecret, isTestMode, DEFAULT_SECRETS };

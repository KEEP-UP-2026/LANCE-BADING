const crypto = require('crypto');
const { isTestMode } = require('../config/jwtConfig');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getAllowedOrigins(req) {
  const host = req.get('host');
  if (!host) return [];
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return [
    `${protocol}://${host}`,
    `http://127.0.0.1:${process.env.PORT || 3000}`,
    `http://localhost:${process.env.PORT || 3000}`
  ];
}

function isValidOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    return getAllowedOrigins(req).includes(origin);
  }
  const referer = req.headers.referer;
  if (referer) {
    return getAllowedOrigins(req).some(allowed => referer.startsWith(allowed));
  }
  // Same-origin requests may omit Origin/Referer; CSRF double-submit still applies.
  return true;
}

const CsrfMiddleware = {
  CSRF_COOKIE,
  CSRF_HEADER,

  issueToken(req, res) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });
    return token;
  },

  getToken(req, res) {
    const token = this.issueToken(req, res);
    return res.status(200).json({ success: true, csrfToken: token });
  },

  validate(req, res, next) {
    if (isTestMode()) return next();

    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

    if (!isValidOrigin(req)) {
      return res.status(403).json({ success: false, message: 'Cross-origin request rejected.' });
    }

    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ success: false, message: 'CSRF token missing or invalid.' });
    }

    next();
  }
};

module.exports = CsrfMiddleware;

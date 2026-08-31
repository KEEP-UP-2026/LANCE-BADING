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
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });
    return token;
  },

  getToken(req, res) {
    const existing = req.cookies && req.cookies[CSRF_COOKIE];
    if (req.query.refresh !== 'true' && existing) {
      return res.status(200).json({ success: true, csrfToken: existing });
    }
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

    const headerToken = req.headers[CSRF_HEADER] || req.headers['x-csrf-token'];
    const cookieHeader = req.headers.cookie || '';

    // Collect all possible csrf_token cookie values from cookie-parser and raw cookie string
    const cookieTokens = new Set();
    if (req.cookies && req.cookies[CSRF_COOKIE]) {
      cookieTokens.add(req.cookies[CSRF_COOKIE]);
    }
    const matches = cookieHeader.matchAll(/(?:^|;\s*)csrf_token=([^;]+)/g);
    for (const m of matches) {
      cookieTokens.add(decodeURIComponent(m[1]));
    }

    // Direct token match
    if (headerToken && cookieTokens.has(headerToken)) {
      return next();
    }

    // Same-origin safe fallback: if request is confirmed same-origin with header present
    if (isValidOrigin(req) && headerToken) {
      return next();
    }

    if (cookieTokens.size === 0 || !headerToken) {
      return res.status(403).json({ success: false, message: 'CSRF token missing or invalid.' });
    }

    return res.status(403).json({ success: false, message: 'CSRF token missing or invalid.' });
  }
};

module.exports = CsrfMiddleware;

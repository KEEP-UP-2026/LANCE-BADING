// In-memory rate limiting (single-process; use Redis for multi-instance production)

const { isTestMode } = require('../config/jwtConfig');

class SlidingWindowLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.buckets = new Map();
  }

  isAllowed(key) {
    if (isTestMode()) return true;
    const now = Date.now();
    const hits = (this.buckets.get(key) || []).filter(t => now - t < this.windowMs);
    if (hits.length >= this.maxRequests) {
      this.buckets.set(key, hits);
      return false;
    }
    hits.push(now);
    this.buckets.set(key, hits);
    return true;
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const loginLimiter = new SlidingWindowLimiter(
  (parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 10) || 15) * 60 * 1000,
  parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10) || 10
);

const uploadLimiter = new SlidingWindowLimiter(
  (parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MINUTES, 10) || 10) * 60 * 1000,
  parseInt(process.env.UPLOAD_RATE_LIMIT_MAX_REQUESTS, 10) || 20
);

const searchLimiter = new SlidingWindowLimiter(
  (parseInt(process.env.SEARCH_RATE_LIMIT_WINDOW_MINUTES, 10) || 1) * 60 * 1000,
  parseInt(process.env.SEARCH_RATE_LIMIT_MAX_REQUESTS, 10) || 60
);

const downloadLimiter = new SlidingWindowLimiter(60 * 1000, 120);
const mergeLimiter = new SlidingWindowLimiter(60 * 1000, 30);
const exportAuditLimiter = new SlidingWindowLimiter(60 * 1000, 60);

function rateLimitResponse(res) {
  return res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.'
  });
}

const RateLimitMiddleware = {
  login(req, res, next) {
    const ip = getClientIp(req);
    const email = normalizeEmail(req.body?.email);
    const key = email ? `login:${ip}:${email}` : `login:${ip}`;
    if (!loginLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  },

  upload(req, res, next) {
    const key = req.user ? `upload:${req.user.id}` : `upload:${getClientIp(req)}`;
    if (!uploadLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  },

  search(req, res, next) {
    const key = req.user ? `search:${req.user.id}` : `search:${getClientIp(req)}`;
    if (!searchLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  },

  download(req, res, next) {
    const key = req.user ? `download:${req.user.id}` : `download:${getClientIp(req)}`;
    if (!downloadLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  },

  merge(req, res, next) {
    const key = req.user ? `merge:${req.user.id}` : `merge:${getClientIp(req)}`;
    if (!mergeLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  },

  exportAudit(req, res, next) {
    const key = req.user ? `export-audit:${req.user.id}` : `export-audit:${getClientIp(req)}`;
    if (!exportAuditLimiter.isAllowed(key)) return rateLimitResponse(res);
    next();
  }
};

module.exports = RateLimitMiddleware;

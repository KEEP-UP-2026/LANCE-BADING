const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const { validateJwtSecret } = require('../config/jwtConfig');

const JWT_SECRET = validateJwtSecret();

// Helper to find the correct dashboard for a role
function getDashboardPath(role) {
  switch (role) {
    case 'RHU_ADMINISTRATOR':
      return '/dashboard/admin';
    case 'RECORDS_STAFF':
      return '/dashboard/records';
    case 'HEALTHCARE_PERSONNEL':
      return '/dashboard/healthcare';
    case 'ADMINISTRATIVE_STAFF':
      return '/dashboard/administrative';
    default:
      return '/login';
  }
}

const AuthMiddleware = {
  // Authentication check (sets req.user if valid token exists)
  async authenticate(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Fetch fresh user from DB to verify active status and role (since admin can change role/status dynamically)
      const user = await UserModel.findById(decoded.id);

      if (!user) {
        res.clearCookie('token');
        req.user = null;
        return next();
      }

      if (user.status === 'INACTIVE') {
        res.clearCookie('token');
        req.user = null;
        return next();
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('JWT authentication error:', error);
      res.clearCookie('token');
      req.user = null;
      next();
    }
  },

  // Route protector for HTML Pages
  requirePageAuth(allowedRoles) {
    return async (req, res, next) => {
      // 1. Check if user is logged in
      if (!req.user) {
        return res.redirect('/login');
      }

      // 2. Check if account is active (already verified in authenticate, but double check)
      if (req.user.status === 'INACTIVE') {
        res.clearCookie('token');
        return res.redirect('/login?error=account_disabled');
      }

      // 3. Check user role
      if (!allowedRoles.includes(req.user.role)) {
        // Redirect to their correct dashboard with error flag
        const correctDashboard = getDashboardPath(req.user.role);
        return res.redirect(`${correctDashboard}?error=unauthorized`);
      }

      next();
    };
  },

  // Route protector for API endpoints (returns JSON)
  requireApiAuth(allowedRoles) {
    return async (req, res, next) => {
      // 1. Check if user is logged in
      if (!req.user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required. Please log in.' 
        });
      }

      // 2. Check if account is active
      if (req.user.status === 'INACTIVE') {
        res.clearCookie('token');
        return res.status(403).json({ 
          success: false, 
          message: 'Account disabled. Please contact your administrator.' 
        });
      }

      // 3. Check user role
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied. Unauthorized role.' 
        });
      }

      next();
    };
  }
};

module.exports = AuthMiddleware;

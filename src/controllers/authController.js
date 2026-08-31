const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const AuditMiddleware = require('../middleware/auditMiddleware');
const { validateJwtSecret } = require('../config/jwtConfig');

const JWT_SECRET = validateJwtSecret();

const AuthController = {
  // Handle user login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // 1. Check if email or password is empty
      if (!email || !password || email.trim() === '' || password.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: 'Email and password are required fields.' 
        });
      }

      // 2. Find user by email
      const user = await UserModel.findByEmail(email);

      // 3. If user does not exist
      if (!user) {
        await AuditMiddleware.logActivity(null, email, 'LOGIN_FAILED_CREDENTIALS', `Failed login attempt for non-existent user: ${email}`, req);
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password.' 
        });
      }

      // 4. If user status is INACTIVE
      if (user.status === 'INACTIVE') {
        await AuditMiddleware.logActivity(user.id, user.email, 'LOGIN_FAILED_INACTIVE', `Disabled account access attempt: ${email}`, req);
        return res.status(403).json({ 
          success: false, 
          message: 'Account is disabled.' 
        });
      }

      // 5. Compare entered password with stored hashed password
      const isMatch = bcrypt.compareSync(password, user.password);
      if (!isMatch) {
        await AuditMiddleware.logActivity(user.id, user.email, 'LOGIN_FAILED_CREDENTIALS', `Failed password login attempt: ${email}`, req);
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password.' 
        });
      }

      // 6. Create authentication token (JWT)
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          role: user.role, 
          full_name: user.full_name,
          status: user.status
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      // 7. Store authenticated user data via cookie (HttpOnly for security)
      res.cookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      await AuditMiddleware.logActivity(user.id, user.email, 'USER_LOGIN', `User logged in successfully with role ${user.role}.`, req);

      // Define dashboard path based on role
      let redirectUrl = '/login';
      switch (user.role) {
        case 'RHU_ADMINISTRATOR':
          redirectUrl = '/dashboard/admin';
          break;
        case 'RECORDS_STAFF':
          redirectUrl = '/dashboard/records';
          break;
        case 'HEALTHCARE_PERSONNEL':
          redirectUrl = '/dashboard/healthcare';
          break;
        case 'ADMINISTRATIVE_STAFF':
          redirectUrl = '/dashboard/administrative';
          break;
      }

      return res.status(200).json({
        success: true,
        message: 'Login successful. Redirecting...',
        redirectUrl,
        user: {
          full_name: user.full_name,
          email: user.email,
          role: user.role
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'An internal server error occurred during login.' 
      });
    }
  },

  // Handle user logout
  async logout(req, res) {
    try {
      if (req.user) {
        await AuditMiddleware.logActivity(req.user.id, req.user.email, 'USER_LOGOUT', 'User logged out successfully.', req);
      }
      res.clearCookie('token', { path: '/' });
      return res.status(200).json({ 
        success: true, 
        message: 'Logged out successfully.',
        redirectUrl: '/login'
      });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'An internal server error occurred during logout.' 
      });
    }
  },

  // Get current user profile (useful for frontend load)
  async me(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
      }

      // Fetch fresh record from DB to ensure status and role are accurate
      const user = await UserModel.findById(req.user.id);
      if (!user) {
        res.clearCookie('token', { path: '/' });
        return res.status(401).json({ success: false, message: 'User no longer exists.' });
      }

      if (user.status === 'INACTIVE') {
        res.clearCookie('token', { path: '/' });
        return res.status(403).json({ success: false, message: 'Account is disabled.', redirectUrl: '/login?error=account_disabled' });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          status: user.status
        }
      });
    } catch (error) {
      console.error('Me profile error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  }
};

module.exports = AuthController;

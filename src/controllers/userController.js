const bcrypt = require('bcryptjs');
const UserModel = require('../models/userModel');
const AuditMiddleware = require('../middleware/auditMiddleware');

const ALLOWED_ROLES = [
  'RHU_ADMINISTRATOR',
  'RECORDS_STAFF',
  'HEALTHCARE_PERSONNEL',
  'ADMINISTRATIVE_STAFF'
];

const ALLOWED_STATUSES = ['ACTIVE', 'INACTIVE'];

const UserController = {
  // Get all users (Admin only)
  async listUsers(req, res) {
    try {
      const users = await UserModel.findAll();
      // Remove passwords from response for security
      const cleanUsers = users.map(u => {
        const { password, ...userWithoutPassword } = u;
        return userWithoutPassword;
      });
      
      return res.status(200).json({
        success: true,
        users: cleanUsers
      });
    } catch (error) {
      console.error('List users error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving users.'
      });
    }
  },

  // Create a new user (Admin only)
  async createUser(req, res) {
    try {
      const { full_name, email, password, role } = req.body;

      // 1. Validate required fields
      if (!full_name || !full_name.trim()) {
        return res.status(400).json({ success: false, message: 'Full name is required.' });
      }
      if (!email || !email.trim()) {
        return res.status(400).json({ success: false, message: 'Email address is required.' });
      }
      if (!password || !password.trim()) {
        return res.status(400).json({ success: false, message: 'Password is required.' });
      }
      if (!role || !role.trim()) {
        return res.status(400).json({ success: false, message: 'Role assignment is required.' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      }

      // Validate role enum
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role selection.' });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
      }

      // 2. Check if email already exists
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'A user with this email address already exists.' });
      }

      // 3. Hash password
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(password, salt);

      // 4. Save new user to users table
      const newUser = await UserModel.create({
        full_name: full_name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role,
        status: 'ACTIVE' // Default status
      });

      const { password: _, ...userWithoutPassword } = newUser;

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'USER_CREATED', `Created user ${newUser.email} with role ${newUser.role}`, req);

      return res.status(201).json({
        success: true,
        message: `Account created successfully for ${full_name}.`,
        user: userWithoutPassword
      });

    } catch (error) {
      console.error('Create user error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while creating the user.'
      });
    }
  },

  // Update user role or status (Admin only)
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { role, status } = req.body;

      // Find user to verify existence
      const user = await UserModel.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Prevent admin from modifying their own account status or role
      if (user.id === req.user.id) {
        if (status && status !== 'ACTIVE') {
          return res.status(400).json({ 
            success: false, 
            message: 'Safety Guard: You cannot deactivate your own administrator account.' 
          });
        }
        if (role && role !== 'RHU_ADMINISTRATOR') {
          return res.status(400).json({ 
            success: false, 
            message: 'Safety Guard: You cannot change your own administrator role.' 
          });
        }
      }

      const updates = {};

      // Validate and set role if provided
      if (role) {
        if (!ALLOWED_ROLES.includes(role)) {
          return res.status(400).json({ success: false, message: 'Invalid role selection.' });
        }
        updates.role = role;
      }

      // Validate and set status if provided
      if (status) {
        if (!ALLOWED_STATUSES.includes(status)) {
          return res.status(400).json({ success: false, message: 'Invalid status selection.' });
        }
        updates.status = status;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'No valid update parameters provided.' });
      }

      const updatedUser = await UserModel.update(id, updates);
      const { password: _, ...userWithoutPassword } = updatedUser;

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'USER_UPDATED', `Updated user ${user.email} status to ${updates.status || user.status} and role to ${updates.role || user.role}`, req);

      return res.status(200).json({
        success: true,
        message: 'User account updated successfully.',
        user: userWithoutPassword
      });

    } catch (error) {
      console.error('Update user error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while updating the user.'
      });
    }
  }
};

module.exports = UserController;

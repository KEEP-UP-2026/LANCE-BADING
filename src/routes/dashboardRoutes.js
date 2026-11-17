const express = require('express');
const path = require('path');
const router = express.Router();
const AuthMiddleware = require('../middleware/authMiddleware');

// Middleware to prevent caching of dashboard HTML files (secures browser back-button access after logout)
const nocache = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
};

// Authenticate and prevent caching for all dashboard page requests
router.use(AuthMiddleware.authenticate);
router.use(nocache);

const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL', 'ADMINISTRATIVE_STAFF'];
const ALLOWED_WRITE_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'ADMINISTRATIVE_STAFF'];

// RHU Administrator pages
router.get('/admin', 
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR']), 
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/admin.html'));
  }
);

router.get('/admin/users', 
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR']), 
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/admin-users.html'));
  }
);

router.get('/admin/audit', 
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR']), 
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/admin-audit.html'));
  }
);

// Records Overview Route - Redirects any user away from /dashboard/records to their active portal
router.get('/records', 
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES), 
  (req, res) => {
    if (req.user && req.user.role === 'RHU_ADMINISTRATOR') {
      return res.redirect('/dashboard/admin');
    }
    if (req.user && req.user.role === 'ADMINISTRATIVE_STAFF') {
      return res.redirect('/dashboard/reports');
    }
    if (req.user && req.user.role === 'HEALTHCARE_PERSONNEL') {
      return res.redirect('/dashboard/patients');
    }
    return res.redirect('/dashboard/patients');
  }
);

// Healthcare Personnel page - Redirect to Patient Directory
router.get('/healthcare', 
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES), 
  (req, res) => {
    res.redirect('/dashboard/patients');
  }
);

// Administrative Staff page (Redirect to Reports Dashboard)
router.get('/administrative', 
  AuthMiddleware.requirePageAuth(['ADMINISTRATIVE_STAFF']), 
  (req, res) => {
    res.redirect('/dashboard/reports');
  }
);

// Reports Dashboard (Administrative Staff ONLY)
router.get('/reports',
  AuthMiddleware.requirePageAuth(['ADMINISTRATIVE_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/reports.html'));
  }
);

// Patient Management Page Routes (Clinical Staff only)
router.get('/patients', 
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/patient-list.html'));
  }
);

router.get('/patients/add', 
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/patient-add.html'));
  }
);

router.get('/patients/edit/:id', 
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/patient-edit.html'));
  }
);

router.get('/patients/profile/:id', 
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/patient-profile.html'));
  }
);

// Objective 3: New Web Pages Routes
router.get('/records/batch-upload',
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.redirect('/dashboard/records/batch-status?openUpload=true');
  }
);

router.get('/records/batch-status',
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/batch-status.html'));
  }
);

router.get('/records/batch-status/:id',
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/batch-status.html'));
  }
);

router.get('/records/batch-review/:itemId',
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/batch-review.html'));
  }
);

// Legacy single-upload route redirected to modern batch scan/upload pipeline
router.get(['/records/upload', '/records/upload/:patientId'],
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    const patientId = req.params.patientId;
    if (patientId) {
      return res.redirect(`/dashboard/records/batch-status?openUpload=true&patient_id=${encodeURIComponent(patientId)}`);
    }
    return res.redirect('/dashboard/records/batch-status?openUpload=true');
  }
);

router.get('/records/view',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.redirect('/dashboard/patients');
  }
);

router.get('/records/view/:id',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/record-view.html'));
  }
);

router.get('/search',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/search.html'));
  }
);

router.get('/duplicates',
  AuthMiddleware.requirePageAuth(['RECORDS_STAFF', 'ADMINISTRATIVE_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/duplicate-warnings.html'));
  }
);

router.get('/archives',
  AuthMiddleware.requirePageAuth(['RECORDS_STAFF', 'ADMINISTRATIVE_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/archives.html'));
  }
);

// Fast Document Lists by Category
router.get('/documents',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/documents-list.html'));
  }
);

router.get('/documents/:category',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/documents-list.html'));
  }
);

router.get('/records/category/:category',
  AuthMiddleware.requirePageAuth(ALLOWED_READ_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/documents-list.html'));
  }
);

module.exports = router;



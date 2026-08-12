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

// Records Staff page
router.get('/records', 
  AuthMiddleware.requirePageAuth(['RECORDS_STAFF']), 
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/records.html'));
  }
);

// Healthcare Personnel page
router.get('/healthcare', 
  AuthMiddleware.requirePageAuth(['HEALTHCARE_PERSONNEL']), 
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/healthcare.html'));
  }
);

// Administrative Staff page (Redirect to Reports Dashboard)
router.get('/administrative', 
  AuthMiddleware.requirePageAuth(['ADMINISTRATIVE_STAFF']), 
  (req, res) => {
    res.redirect('/dashboard/reports');
  }
);

// Reports Dashboard
router.get('/reports',
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR', 'ADMINISTRATIVE_STAFF', 'RECORDS_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/reports.html'));
  }
);

// Patient Management Page Routes
const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL', 'ADMINISTRATIVE_STAFF'];
const ALLOWED_WRITE_ROLES = ['RECORDS_STAFF'];

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
router.get('/records/upload/:patientId',
  AuthMiddleware.requirePageAuth(ALLOWED_WRITE_ROLES),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/record-upload.html'));
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
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR', 'RECORDS_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/duplicate-warnings.html'));
  }
);

router.get('/archives',
  AuthMiddleware.requirePageAuth(['RHU_ADMINISTRATOR', 'RECORDS_STAFF']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../views/archives.html'));
  }
);

module.exports = router;


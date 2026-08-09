const express = require('express');
const router = express.Router();
const PatientController = require('../controllers/patientController');
const AuthMiddleware = require('../middleware/authMiddleware');

const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL'];
const ALLOWED_WRITE_ROLES = ['RECORDS_STAFF'];

// Require valid authentication check on all patient API endpoints
router.use(AuthMiddleware.authenticate);

// Read-only operations (list and view profile details)
router.get('/', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), PatientController.listPatients);
router.get('/:id', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), PatientController.getPatient);

// Write operations (add, edit, archive) - Records Staff only
router.post('/', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), PatientController.createPatient);
router.put('/:id', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), PatientController.updatePatient);
router.put('/:id/archive', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), PatientController.archivePatient);
router.put('/:id/restore', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), PatientController.restorePatient);

module.exports = router;

const express = require('express');
const router = express.Router();
const RecordController = require('../controllers/recordController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL'];
const ALLOWED_WRITE_ROLES = ['RECORDS_STAFF'];

router.use(AuthMiddleware.authenticate);

router.post('/ocr-preview', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.uploadMiddleware, RecordController.ocrPreview);
router.post('/upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.uploadMiddleware, RecordController.upload);
router.post('/confirm-upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.confirmUpload);
router.post('/cancel-upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.cancelUpload);
router.get('/recent', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.listRecentRecords);
router.get('/patient/:patientId', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.getPatientRecords);
router.put('/:id/archive', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.archiveRecord);
router.put('/:id', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.updateRecordMetadata);
router.get('/download/:filename', RateLimitMiddleware.download, AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.downloadRecord);

module.exports = router;

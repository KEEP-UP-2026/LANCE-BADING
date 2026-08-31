const express = require('express');
const router = express.Router();
const RecordController = require('../controllers/recordController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_READ_ROLES = ['RECORDS_STAFF', 'HEALTHCARE_PERSONNEL', 'ADMINISTRATIVE_STAFF'];
const ALLOWED_WRITE_ROLES = ['RECORDS_STAFF', 'ADMINISTRATIVE_STAFF'];

router.use(AuthMiddleware.authenticate);

router.post('/enhance-preview', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.uploadMiddleware, RecordController.enhancePreview);
router.get('/temp-image/:token', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.getTempImage);
router.post('/classify-preview', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.classifyPreview);
router.post('/ocr-preview', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.ocrPreview);
router.post('/upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.uploadMiddleware, RecordController.upload);
router.post('/confirm-upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.confirmUpload);
router.post('/manual-create', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.createManualRecord);
router.post('/cancel-upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.cancelUpload);
router.get('/recent', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.listRecentRecords);
router.get('/by-category', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.listRecordsByCategory);
router.get('/archived', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.listArchivedRecords);
router.get('/patient/:patientId', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.getPatientRecords);
router.get('/detail/:id', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.getRecordById);
router.put('/:id/archive', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.archiveRecord);
router.put('/:id/restore', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.restoreRecord);
router.delete('/:id', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.deleteRecord);
router.put('/:id', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), RecordController.updateRecordMetadata);
router.get('/download/:id/docx', RateLimitMiddleware.download, AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.downloadAsDocx);
router.get('/download/:filename', RateLimitMiddleware.download, AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), RecordController.downloadRecord);

module.exports = router;


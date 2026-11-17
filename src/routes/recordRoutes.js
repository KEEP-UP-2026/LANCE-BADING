const express = require('express');
const router = express.Router();
const RecordController = require('../controllers/recordController');
const BatchController = require('../controllers/batchController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL', 'ADMINISTRATIVE_STAFF'];
const ALLOWED_WRITE_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'ADMINISTRATIVE_STAFF'];

router.use(AuthMiddleware.authenticate);

// ==========================================
// BATCH PROCESSING PIPELINE ROUTES
// ==========================================
router.post('/batch/upload', RateLimitMiddleware.upload, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.uploadBatchMiddleware, BatchController.createBatchJob);
router.post('/batch/recover', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.recoverBatches);
router.get('/batch/all-items', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), BatchController.getAllBatchItems);
router.get('/batch/jobs', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), BatchController.listBatches);
router.get('/batch/status/:batchId', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), BatchController.getBatchStatus);
router.get('/batch/item/:itemId', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), BatchController.getBatchItem);
router.get('/batch/file/:itemId', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), BatchController.serveBatchFile);
router.put('/batch/item/:itemId/review', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.saveDraftCorrection);
router.post('/batch/item/:itemId/manual', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.saveManualProcessing);
router.post('/batch/item/:itemId/confirm', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.confirmBatchItem);
router.delete('/batch/item/:itemId/reject', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), BatchController.rejectBatchItem);

// ==========================================
// SINGLE RECORD PIPELINE ROUTES
// ==========================================

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


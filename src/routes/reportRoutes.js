const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/reportController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_ROLES = ['RHU_ADMINISTRATOR', 'ADMINISTRATIVE_STAFF', 'RECORDS_STAFF'];

router.use(AuthMiddleware.authenticate);
router.use(AuthMiddleware.requireApiAuth(ALLOWED_ROLES));

router.get('/stats', ReportController.getStats);
router.get('/data', ReportController.getReportData);
router.post('/audit-export', RateLimitMiddleware.exportAudit, ReportController.auditExport);
router.get('/audit-logs', AuthMiddleware.requireApiAuth(['RHU_ADMINISTRATOR']), ReportController.getAuditLogs);

module.exports = router;

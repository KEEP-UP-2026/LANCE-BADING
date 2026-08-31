const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/reportController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_CLINICAL_ROLES = ['ADMINISTRATIVE_STAFF'];

router.use(AuthMiddleware.authenticate);

// Clinical Analytics & Reports Routes (Administrative & Healthcare Personnel)
router.get('/', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getWeeklyAnalytics);
router.get('/stats', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getStats);
router.get('/analytics/weekly', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getWeeklyAnalytics);
router.get('/analytics/monthly', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getMonthlyAnalytics);
router.get('/analytics/yearly', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getYearlyAnalytics);
router.get('/data', AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.getReportData);
router.post('/audit-export', RateLimitMiddleware.exportAudit, AuthMiddleware.requireApiAuth(ALLOWED_CLINICAL_ROLES), ReportController.auditExport);

// Audit Log Review (RHU Administrator only)
router.get('/audit-logs', AuthMiddleware.requireApiAuth(['RHU_ADMINISTRATOR']), ReportController.getAuditLogs);

module.exports = router;

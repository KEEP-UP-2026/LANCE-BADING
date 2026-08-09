const express = require('express');
const router = express.Router();
const SearchController = require('../controllers/searchController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_READ_ROLES = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL'];

router.use(AuthMiddleware.authenticate);
router.get('/', RateLimitMiddleware.search, AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), SearchController.unifiedSearch);

module.exports = router;

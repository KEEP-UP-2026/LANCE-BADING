const express = require('express');
const router = express.Router();
const DuplicateController = require('../controllers/duplicateController');
const AuthMiddleware = require('../middleware/authMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

const ALLOWED_READ_ROLES = ['RECORDS_STAFF', 'ADMINISTRATIVE_STAFF'];
const ALLOWED_WRITE_ROLES = ['RECORDS_STAFF', 'ADMINISTRATIVE_STAFF'];

router.use(AuthMiddleware.authenticate);
router.get('/', AuthMiddleware.requireApiAuth(ALLOWED_READ_ROLES), DuplicateController.listPending);
router.put('/:id', AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), DuplicateController.updateStatus);
router.post('/:id/merge', RateLimitMiddleware.merge, AuthMiddleware.requireApiAuth(ALLOWED_WRITE_ROLES), DuplicateController.mergePatients);

module.exports = router;

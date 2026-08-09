const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const AuthMiddleware = require('../middleware/authMiddleware');
const CsrfMiddleware = require('../middleware/csrfMiddleware');
const RateLimitMiddleware = require('../middleware/rateLimitMiddleware');

router.get('/csrf-token', CsrfMiddleware.getToken.bind(CsrfMiddleware));
router.post('/login', RateLimitMiddleware.login, AuthController.login);
router.post('/logout', AuthMiddleware.authenticate, AuthController.logout);
router.get('/me', AuthMiddleware.authenticate, AuthController.me);

module.exports = router;

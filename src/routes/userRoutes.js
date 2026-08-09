const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const AuthMiddleware = require('../middleware/authMiddleware');

// All user management routes require RHU_ADMINISTRATOR role
router.use(AuthMiddleware.authenticate);
router.use(AuthMiddleware.requireApiAuth(['RHU_ADMINISTRATOR']));

router.get('/', UserController.listUsers);
router.post('/', UserController.createUser);
router.put('/:id', UserController.updateUser);

module.exports = router;

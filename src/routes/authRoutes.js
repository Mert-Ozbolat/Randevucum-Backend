const express = require('express');
const authController = require('../controllers/authController');
const { registerRules, loginRules, googleAuthRules, validate } = require('../validators/authValidator');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/register', registerRules(), validate, authController.register);
router.post('/login', loginRules(), validate, authController.login);
router.post('/google', googleAuthRules(), validate, authController.googleAuth);
router.get('/me', protect, authController.me);

module.exports = router;

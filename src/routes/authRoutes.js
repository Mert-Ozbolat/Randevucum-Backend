const express = require('express');
const authController = require('../controllers/authController');
const { registerRules, loginRules, googleAuthRules, validate } = require('../validators/authValidator');

const router = express.Router();

router.post('/register', registerRules(), validate, authController.register);
router.post('/login', loginRules(), validate, authController.login);
router.post('/google', googleAuthRules(), validate, authController.googleAuth);

module.exports = router;

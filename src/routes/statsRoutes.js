const express = require('express');
const statsController = require('../controllers/statsController');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/home', statsController.getHomeStats);
router.post('/presence', optionalAuth, statsController.postPresence);

module.exports = router;

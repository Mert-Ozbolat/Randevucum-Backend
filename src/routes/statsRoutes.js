const express = require('express');
const statsController = require('../controllers/statsController');
const { optionalAuth, protect } = require('../middleware/auth');
const { requireBusinessOwnership } = require('../middleware/ownership');

const router = express.Router();

router.get('/home', statsController.getHomeStats);
router.post('/presence', optionalAuth, statsController.postPresence);

// Business dashboard analytics
router.get(
  '/business/:businessId/analytics',
  protect,
  requireBusinessOwnership,
  statsController.getBusinessAnalytics
);

module.exports = router;

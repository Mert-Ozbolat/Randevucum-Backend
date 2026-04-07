const express = require('express');
const businessController = require('../controllers/businessController');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/areas', optionalAuth, businessController.listAreas);
router.get('/professions', optionalAuth, businessController.listProfessions);
router.get('/businesses', optionalAuth, businessController.listBusinessesByAreaProfession);

module.exports = router;


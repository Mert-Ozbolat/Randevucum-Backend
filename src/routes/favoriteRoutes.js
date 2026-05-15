const express = require('express');
const favoriteController = require('../controllers/favoriteController');
const { protect } = require('../middleware/auth');
const {
  businessIdBodyRules,
  businessIdParamRules,
  validate,
} = require('../validators/favoriteValidator');

const router = express.Router();

router.use(protect);

router.get('/me', favoriteController.listMyFavorites);
router.get('/ids', favoriteController.listMyFavoriteIds);
router.post('/', businessIdBodyRules(), validate, favoriteController.addFavorite);
router.post('/toggle', businessIdBodyRules(), validate, favoriteController.toggleFavorite);
router.delete('/:businessId', businessIdParamRules(), validate, favoriteController.removeFavorite);

module.exports = router;

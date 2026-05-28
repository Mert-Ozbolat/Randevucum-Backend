const express = require('express');
const ultramsgWebhookController = require('../controllers/ultramsgWebhookController');
const { requireUltraMsgWebhookSecret } = require('../middleware/ultramsgAuth');

const router = express.Router();

// UltraMsg incoming webhook (message_received)
router.post('/ultramsg', requireUltraMsgWebhookSecret, ultramsgWebhookController.ultramsgIncoming);

module.exports = router;


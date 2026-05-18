const express = require('express');
const jobController = require('../controllers/jobController');

const router = express.Router();

router.post('/whatsapp-reminders', jobController.sendWhatsAppReminders);
router.get('/whatsapp-reminders', jobController.sendWhatsAppReminders);
router.post('/whatsapp-test-booking', jobController.testBookingWhatsApp);

module.exports = router;


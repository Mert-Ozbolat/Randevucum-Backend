const express = require('express');
const jobController = require('../controllers/jobController');
const { requireJobsSecret } = require('../middleware/jobsAuth');

const router = express.Router();

router.use(requireJobsSecret);

router.post('/whatsapp-reminders', jobController.sendWhatsAppReminders);
router.get('/whatsapp-reminders', jobController.sendWhatsAppReminders);
router.post('/whatsapp-test-booking', jobController.testBookingWhatsApp);

module.exports = router;

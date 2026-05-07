const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { runWhatsAppReminders } = require('../jobs/whatsappReminders');

function requireJobsSecret(req, res) {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return false;
  const header = req.headers['x-jobs-secret'];
  const token = req.query?.token;
  return header === secret || token === secret;
}

/**
 * POST /jobs/whatsapp-reminders (or GET)
 * Protected by JOBS_SECRET (x-jobs-secret header or ?token=)
 */
exports.sendWhatsAppReminders = asyncHandler(async (req, res) => {
  if (!requireJobsSecret(req, res)) {
    return error(res, 401, 'Not authorized.');
  }
  const result = await runWhatsAppReminders();
  return success(res, 200, result, 'OK');
});


const path = require("path");

// Always load backend/.env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("./config/db");
const app = require("./app");
const { runWhatsAppReminders } = require("./jobs/whatsappReminders");

// 🔥 Cloud Run PORT FIX
const PORT = process.env.PORT || 8080;

// 🔥 IMPORTANT: 0.0.0.0 bind (Cloud Run için şart)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Optional in-process scheduler (not recommended for scale-to-zero/serverless),
  // but useful for single-instance deployments. Prefer Cloud Scheduler calling /jobs/whatsapp-reminders.
  const enabled = String(process.env.ENABLE_REMINDER_CRON || "").toLowerCase() === "true";
  if (enabled) {
    const everyMs = Number(process.env.REMINDER_CRON_EVERY_MS || 60_000);
    console.log(`[jobs] WhatsApp reminder cron enabled: every ${everyMs}ms`);
    setInterval(() => {
      runWhatsAppReminders()
        .then((r) => console.log("[jobs] whatsapp-reminders result", r))
        .catch((e) => console.error("[jobs] whatsapp-reminders error", e?.message || e));
    }, everyMs);
  }
});

// DB bağlantısını arkada başlat
connectDB().catch((err) => {
  console.error("❌ MongoDB connection failed::", err?.message || err);
});

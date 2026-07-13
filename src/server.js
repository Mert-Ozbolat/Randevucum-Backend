const path = require("path");

// Always load backend/.env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { validateEnv } = require("./config/env");
validateEnv();

const connectDB = require("./config/db");
const app = require("./app");
const { runWhatsAppReminders } = require("./jobs/whatsappReminders");
const { runSubscriptionBillingMaintenance } = require("./jobs/subscriptionBilling");
const { runMetaWhatsAppStartupHealthCheck } = require("./services/whatsappMetaHealth");

// 🔥 Cloud Run PORT FIX
const PORT = process.env.PORT || 8080;

// 🔥 IMPORTANT: 0.0.0.0 bind (Cloud Run için şart)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);

  runMetaWhatsAppStartupHealthCheck().catch((err) => {
    console.error("[whatsapp] Meta startup health check failed", err?.message || err);
  });

  // Optional in-process scheduler (not recommended for scale-to-zero/serverless),
  // but useful for single-instance deployments. Prefer Cloud Scheduler calling /jobs/whatsapp-reminders.
  // Varsayılan: açık. Kapatmak için .env → ENABLE_REMINDER_CRON=false
  const enabled = String(process.env.ENABLE_REMINDER_CRON || "true").toLowerCase() === "true";
  if (enabled) {
    const everyMs = Number(process.env.REMINDER_CRON_EVERY_MS || 5 * 60 * 1000);
    console.log(`[jobs] WhatsApp reminder cron enabled: every ${everyMs}ms`);
    const tick = () => {
      runWhatsAppReminders()
        .then((r) => console.log("[jobs] whatsapp-reminders result", r))
        .catch((e) => console.error("[jobs] whatsapp-reminders error", e?.message || e));
    };
    tick();
    setInterval(tick, everyMs);
  }

  const billingCronEnabled =
    String(process.env.ENABLE_SUBSCRIPTION_BILLING_CRON || "true").toLowerCase() === "true";
  if (billingCronEnabled) {
    const billingMs = Number(process.env.SUBSCRIPTION_BILLING_CRON_MS || 60 * 60 * 1000);
    console.log(`[jobs] Subscription billing cron enabled: every ${billingMs}ms`);
    const billingTick = () => {
      runSubscriptionBillingMaintenance()
        .then((r) => console.log("[jobs] subscription-billing result", r))
        .catch((e) => console.error("[jobs] subscription-billing error", e?.message || e));
    };
    billingTick();
    setInterval(billingTick, billingMs);
  }
});

// DB bağlantısını arkada başlat
connectDB().catch((err) => {
  console.error("❌ MongoDB connection failed::", err?.message || err);
});

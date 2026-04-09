const path = require("path");

// Always load backend/.env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("./config/db");
const app = require("./app");

// 🔥 Cloud Run PORT FIX
const PORT = process.env.PORT || 8080;

// 🔥 IMPORTANT: 0.0.0.0 bind (Cloud Run için şart)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// DB bağlantısını arkada başlat
connectDB().catch((err) => {
  console.error("❌ MongoDB connection failed:", err?.message || err);
});

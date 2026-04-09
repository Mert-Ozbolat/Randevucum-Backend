const path = require('path');

// Always load backend/.env (not dependent on shell cwd)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('./config/db');
const app = require('./app');

const PORT = process.env.PORT || 5001;

// Cloud Run expects the container to start listening on $PORT quickly.
// Start the HTTP server first, then connect to the DB in the background.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

connectDB().catch((err) => {
  console.error('MongoDB connection failed:', err?.message || err);
  // Keep the server running so Cloud Run can route and show logs/health.
});

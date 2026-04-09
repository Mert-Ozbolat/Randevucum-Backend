const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/webrezervasyon';
  if (!process.env.MONGODB_URI) {
    console.warn('MONGODB_URI not set in .env, using default: mongodb://localhost:27017/webrezervasyon');
  }
  try {
    const conn = await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    // Don't hard-exit here. On Cloud Run we must start listening quickly;
    // callers can decide whether to retry or terminate.
    throw error;
  }
};

module.exports = connectDB;

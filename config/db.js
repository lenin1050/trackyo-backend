const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log('MONGODB_URI not set. Running TrackYo in demo mode without MongoDB.');
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB connected successfully.');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
}

module.exports = { connectDatabase };

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    theme: { type: String, default: 'system' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

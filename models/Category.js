const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    icon: { type: String, default: 'category' },
    color: { type: String, default: '#3B82F6' },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

categorySchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);

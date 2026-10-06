const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    month: { type: String, default: () => new Date().toISOString().slice(0, 7) },
  },
  { timestamps: true },
);

budgetSchema.index({ userId: 1, category: 1, month: 1 }, { unique: true });

module.exports = mongoose.models.Budget || mongoose.model('Budget', budgetSchema);

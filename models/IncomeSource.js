const mongoose = require('mongoose');

const incomeSourceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

incomeSourceSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports =
  mongoose.models.IncomeSource ||
  mongoose.model('IncomeSource', incomeSourceSchema);

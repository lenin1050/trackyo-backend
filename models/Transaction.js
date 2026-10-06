const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: '' },
    incomeSource: { type: String, default: '' },
    description: { type: String, default: '' },
    merchant: { type: String, default: '' },
    paymentMethod: { type: String, default: 'UPI' },
    date: { type: Date, default: Date.now },
    source: { type: String, enum: ['manual', 'sms', 'receipt'], default: 'manual' },
    receiptImage: { type: String, default: '' },
    smsFingerprint: { type: String, trim: true },
  },
  { timestamps: true },
);

transactionSchema.index(
  { userId: 1, smsFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source: 'sms',
      smsFingerprint: { $exists: true },
    },
  },
);

transactionSchema.pre('validate', function validateClassification(next) {
  const hasExpenseCategory =
    typeof this.category === 'string' && this.category.trim().length > 0;
  const hasIncomeSource =
    typeof this.incomeSource === 'string' && this.incomeSource.trim().length > 0;
  if (this.type === 'expense' && (!hasExpenseCategory || hasIncomeSource)) {
    this.invalidate('category', 'Expenses require an expense category only');
  }
  if (this.type === 'income' && (!hasIncomeSource || hasExpenseCategory)) {
    this.invalidate(
      'incomeSource',
      'Income requires an income source only',
    );
  }
  next();
});

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

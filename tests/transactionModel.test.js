const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

const common = {
  userId: new mongoose.Types.ObjectId(),
  amount: 100,
};

test('expense transaction requires category and excludes income source', async () => {
  await assert.rejects(
    new Transaction({ ...common, type: 'expense', incomeSource: 'Salary' }).validate(),
    /Expenses require an expense category only/,
  );
  const expense = new Transaction({
    ...common,
    type: 'expense',
    category: 'Food',
  });
  await expense.validate();
});

test('income transaction requires income source and excludes expense category', async () => {
  await assert.rejects(
    new Transaction({ ...common, type: 'income', category: 'Food' }).validate(),
    /Income requires an income source only/,
  );
  const income = new Transaction({
    ...common,
    type: 'income',
    incomeSource: 'Salary',
  });
  await income.validate();
});

test('SMS message fingerprints are unique per user and only indexed for SMS entries', () => {
  const fingerprintIndex = Transaction.schema.indexes().find(([keys, options]) =>
    keys.userId === 1 &&
    keys.smsFingerprint === 1 &&
    options.unique === true,
  );

  assert.ok(fingerprintIndex);
  assert.deepEqual(fingerprintIndex[1].partialFilterExpression, {
    source: 'sms',
    smsFingerprint: { $exists: true },
  });
});

test('SMS fingerprint is optional on non-SMS transactions', async () => {
  const expense = new Transaction({
    ...common,
    type: 'expense',
    category: 'Food',
    source: 'manual',
  });

  await expense.validate();
  assert.equal(expense.smsFingerprint, undefined);
});

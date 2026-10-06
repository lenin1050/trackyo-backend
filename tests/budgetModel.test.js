const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Budget = require('../models/Budget');

test('monthly budget requires user, category and a positive amount', async () => {
  const userId = new mongoose.Types.ObjectId();
  const budget = new Budget({
    userId,
    category: 'Overall spending',
    amount: 20000,
    month: '2026-10',
  });

  await budget.validate();
  assert.equal(budget.userId.toString(), userId.toString());
  assert.equal(budget.amount, 20000);
  assert.equal(budget.month, '2026-10');
});

test('budgets persist uniquely per user, category and month', () => {
  const uniqueIndex = Budget.schema.indexes().find(([keys, options]) =>
    keys.userId === 1 &&
    keys.category === 1 &&
    keys.month === 1 &&
    options.unique === true,
  );

  assert.ok(uniqueIndex);
});

test('monthly budget rejects non-positive amounts', async () => {
  const budget = new Budget({
    userId: new mongoose.Types.ObjectId(),
    category: 'Overall spending',
    amount: 0,
    month: '2026-10',
  });

  await assert.rejects(budget.validate(), /less than minimum allowed value/);
});

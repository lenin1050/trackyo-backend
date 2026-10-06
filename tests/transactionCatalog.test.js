const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultExpenseCategories,
  defaultIncomeSources,
} = require('../services/transactionCatalog');

test('default expense categories and income sources stay separate', () => {
  assert.deepEqual(defaultExpenseCategories, [
    'Food',
    'Groceries',
    'Travel',
    'Fuel',
    'Shopping',
    'Bills',
    'Entertainment',
    'Health',
    'Education',
    'Rent',
    'Recharge',
    'EMI',
    'Other',
  ]);
  assert.deepEqual(defaultIncomeSources, [
    'Salary',
    'Freelance',
    'Business',
    'Investment',
    'Gift',
    'Other',
  ]);
  assert.equal(defaultIncomeSources.includes('Food'), false);
  assert.equal(defaultExpenseCategories.includes('Salary'), false);
});

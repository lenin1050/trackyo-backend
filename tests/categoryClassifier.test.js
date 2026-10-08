const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyExpenseCategory } = require('../services/categoryClassifier');

const categories = [
  { name: 'Food' },
  { name: 'Travel' },
  { name: 'Shopping' },
  { name: 'Entertainment' },
  { name: 'Health' },
  { name: 'Other' },
];

test('classifies known merchants using categories belonging to the user', () => {
  assert.equal(
    classifyExpenseCategory({ merchant: 'KFC', categories }),
    'Food',
  );
  assert.equal(
    classifyExpenseCategory({ merchant: "Domino's", categories }),
    'Food',
  );
  assert.equal(
    classifyExpenseCategory({ merchant: 'Uber', categories }),
    'Travel',
  );
  assert.equal(
    classifyExpenseCategory({ merchant: 'Amazon', categories }),
    'Shopping',
  );
  assert.equal(
    classifyExpenseCategory({ merchant: 'Netflix', categories }),
    'Entertainment',
  );
  assert.equal(
    classifyExpenseCategory({ merchant: 'Apollo Pharmacy', categories }),
    'Health',
  );
});

test('classification uses a safe existing fallback or returns null', () => {
  assert.equal(
    classifyExpenseCategory({ merchant: 'Unknown merchant', categories }),
    'Other',
  );
  assert.equal(
    classifyExpenseCategory({
      merchant: 'KFC',
      categories: [{ name: 'Shopping' }],
    }),
    null,
  );
  assert.equal(
    classifyExpenseCategory({ merchant: 'KFC', categories: [] }),
    null,
  );
});

test('classification supports grocery, fuel and healthcare category names', () => {
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Green Valley Supermarket',
      categories: [{ name: 'Groceries' }, { name: 'Food' }],
    }),
    'Groceries',
  );
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Shell Petrol Station',
      categories: [{ name: 'Travel' }, { name: 'Fuel' }],
    }),
    'Fuel',
  );
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Apollo Pharmacy',
      categories: [{ name: 'Healthcare' }],
    }),
    'Healthcare',
  );
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Uber',
      categories: [{ name: 'Transport' }],
    }),
    'Transport',
  );
});

test('classifies utility and recharge payments into existing bill categories', () => {
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Mobile Recharge',
      categories: [{ name: 'Bills & Utilities' }, { name: 'Recharge' }],
    }),
    'Bills & Utilities',
  );
  assert.equal(
    classifyExpenseCategory({
      merchant: 'Electricity Board',
      categories: [{ name: 'Bills' }, { name: 'Other' }],
    }),
    'Bills',
  );
});

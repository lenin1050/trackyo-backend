const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OVERALL_BUDGET_CATEGORY,
  calculateBudgetUsage,
} = require('../services/budgetMath');

const transactions = [
  { type: 'expense', category: 'Food', amount: 120, date: '2026-10-01' },
  { type: 'expense', category: 'Travel', amount: 80, date: '2026-10-31' },
  { type: 'income', category: '', amount: 5000, date: '2026-10-15' },
  { type: 'expense', category: 'Food', amount: 300, date: '2026-09-30' },
  { type: 'expense', category: 'Food', amount: 400, date: '2026-11-01' },
];

test('overall budget usage sums all saved expenses for its month only', () => {
  assert.deepEqual(
    calculateBudgetUsage(
      { category: OVERALL_BUDGET_CATEGORY, amount: 500, month: '2026-10' },
      transactions,
    ),
    { spent: 200, remaining: 300, percentUsed: 0.4 },
  );
});

test('category budgets retain category-specific monthly calculations', () => {
  assert.deepEqual(
    calculateBudgetUsage(
      { category: 'Food', amount: 100, month: '2026-10' },
      transactions,
    ),
    { spent: 120, remaining: -20, percentUsed: 1.2 },
  );
});

test('empty transaction history produces an unused budget', () => {
  assert.deepEqual(
    calculateBudgetUsage(
      { category: OVERALL_BUDGET_CATEGORY, amount: 1000, month: '2026-10' },
      [],
    ),
    { spent: 0, remaining: 1000, percentUsed: 0 },
  );
});

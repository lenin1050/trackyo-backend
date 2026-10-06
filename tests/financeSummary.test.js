const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../services/financeSummary');

test('summary keeps income sources separate from expense categories', () => {
  const date = new Date();
  const result = summarize([
    {
      type: 'income',
      amount: 30000,
      incomeSource: 'Salary',
      category: '',
      date,
    },
    {
      type: 'expense',
      amount: 500,
      category: 'Food',
      incomeSource: '',
      date,
    },
  ]);

  assert.equal(result.totalIncome, 30000);
  assert.equal(result.totalExpense, 500);
  assert.equal(result.savings, 29500);
  assert.deepEqual(result.categoryTotals, [{ name: 'Food', total: 500 }]);
  assert.deepEqual(result.incomeSourceTotals, [
    { name: 'Salary', total: 30000 },
  ]);
});

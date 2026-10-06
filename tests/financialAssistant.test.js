const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerFinancialQuestion,
  generateFinancialInsights,
  summarizeFinancialData,
} = require('../services/financialAssistant');

const now = new Date(2026, 9, 5, 12);
const transactions = [
  {
    type: 'income',
    amount: 30000,
    incomeSource: 'Salary',
    date: '2026-10-01',
  },
  {
    type: 'expense',
    amount: 500,
    category: 'Food',
    merchant: 'Cafe',
    date: '2026-10-02',
  },
  {
    type: 'expense',
    amount: 2500,
    category: 'Rent',
    merchant: 'Landlord',
    date: '2026-10-03',
  },
  {
    type: 'expense',
    amount: 1200,
    category: 'Food',
    merchant: 'Restaurant',
    date: '2026-09-10',
  },
];
const budgets = [
  {
    category: 'Overall spending',
    amount: 5000,
    month: '2026-10',
  },
];

test('summarizes current month income, expenses, net and top category', () => {
  const result = summarizeFinancialData(transactions, budgets, now);

  assert.equal(result.currentIncome, 30000);
  assert.equal(result.currentExpense, 3000);
  assert.equal(result.currentNet, 27000);
  assert.deepEqual(result.categoryTotals, [
    { category: 'Rent', amount: 2500 },
    { category: 'Food', amount: 500 },
  ]);
});

test('compares current and previous month expenses', () => {
  const result = summarizeFinancialData(transactions, budgets, now);

  assert.equal(result.previousExpense, 1200);
  assert.equal(result.hasPreviousMonthExpenses, true);
  assert.equal(result.monthChange, 1.5);
});

test('reports remaining budget and percentage from actual expenses', () => {
  const result = summarizeFinancialData(transactions, budgets, now);

  assert.equal(result.overallBudget.spent, 3000);
  assert.equal(result.overallBudget.remaining, 2000);
  assert.equal(result.overallBudget.percentUsed, 0.6);
});

test('identifies the largest saved expense', () => {
  const result = summarizeFinancialData(transactions, budgets, now);

  assert.deepEqual(result.largestExpense, {
    amount: 2500,
    category: 'Rent',
    merchant: 'Landlord',
    date: '03/10/2026',
  });
});

test('date-only largest expense keeps its receipt calendar date across timezones', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Pacific/Honolulu';
  try {
    const result = summarizeFinancialData(
      [
        {
          type: 'expense',
          amount: 2500,
          category: 'Rent',
          date: '2026-10-03',
        },
      ],
      [],
      now,
    );
    assert.equal(result.largestExpense.date, '03/10/2026');
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('generates insight statements from the user data and budget', () => {
  const result = generateFinancialInsights(transactions, budgets, now);

  assert.ok(result.insights.some((line) => line.includes('Rent')));
  assert.ok(result.insights.some((line) => line.includes('₹3,000')));
  assert.ok(result.insights.some((line) => line.includes('last month')));
  assert.ok(result.insights.some((line) => line.includes('₹2,000 remaining')));
  assert.ok(result.insights.some((line) => line.includes('₹30,000')));
});

test('answers supported natural-language finance questions from real data', () => {
  assert.match(
    answerFinancialQuestion('Where did I spend the most?', transactions, budgets, now),
    /Rent.*₹2,500/,
  );
  assert.match(
    answerFinancialQuestion('How much did I spend this month?', transactions, budgets, now),
    /₹3,000/,
  );
  assert.match(
    answerFinancialQuestion('What is my biggest expense?', transactions, budgets, now),
    /₹2,500.*Landlord/,
  );
  assert.match(
    answerFinancialQuestion('How much budget is remaining?', transactions, budgets, now),
    /₹2,000 remaining/,
  );
  assert.match(
    answerFinancialQuestion('Which category should I reduce?', transactions, budgets, now),
    /Rent.*₹2,500/,
  );
  assert.match(
    answerFinancialQuestion('Compare this month with last month.', transactions, budgets, now),
    /₹3,000.*₹1,200/,
  );
  assert.match(
    answerFinancialQuestion('How are my income and expenses?', transactions, budgets, now),
    /₹30,000.*₹3,000.*₹27,000/,
  );
});

test('returns useful responses for no transaction history', () => {
  const insights = generateFinancialInsights([], [], now);
  assert.deepEqual(insights.insights, [
    'Add transactions to get insights based on your spending.',
  ]);
  assert.match(
    answerFinancialQuestion('How much did I spend this month?', [], [], now),
    /no saved transactions or budgets/i,
  );
});

test('can answer budget remaining when transactions are empty', () => {
  assert.match(
    answerFinancialQuestion('How much budget is remaining?', [], budgets, now),
    /₹5,000 remaining/,
  );
});

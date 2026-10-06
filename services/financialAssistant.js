const { calculateBudgetUsage, OVERALL_BUDGET_CATEGORY } = require('./budgetMath');

const currency = (amount) =>
  `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function transactionMonth(item) {
  const value = item.date;
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}`;
  }
  const date = new Date(value);
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

function monthKey(date) {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

function monthOffset(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function formatTransactionDate(value) {
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }
  const date = new Date(value);
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}/${date.getFullYear()}`;
}

function summarizeFinancialData(transactions, budgets = [], now = new Date()) {
  const currentMonth = monthKey(now);
  const previousMonth = monthKey(monthOffset(now, -1));
  const current = transactions.filter(
    (item) => transactionMonth(item) === currentMonth,
  );
  const previous = transactions.filter(
    (item) => transactionMonth(item) === previousMonth,
  );
  const currentExpenses = current.filter((item) => item.type === 'expense');
  const currentIncome = current.filter((item) => item.type === 'income');
  const previousExpenses = previous.filter((item) => item.type === 'expense');
  const sum = (items) =>
    items.reduce((total, item) => total + Number(item.amount || 0), 0);
  const categories = new Map();
  for (const item of currentExpenses) {
    categories.set(
      item.category || 'Other',
      (categories.get(item.category || 'Other') || 0) + Number(item.amount || 0),
    );
  }
  const categoryTotals = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  const largestExpense = [...transactions]
    .filter((item) => item.type === 'expense')
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
  const monthBudgets = budgets.filter((budget) => budget.month === currentMonth);
  const budgetUsage = monthBudgets.map((budget) => ({
    ...budget,
    ...calculateBudgetUsage(budget, transactions),
  }));
  const overallBudget = budgetUsage.find(
    (budget) => budget.category === OVERALL_BUDGET_CATEGORY,
  );
  const currentExpense = sum(currentExpenses);
  const previousExpense = sum(previousExpenses);

  return {
    currentMonth,
    previousMonth,
    currentIncome: sum(currentIncome),
    currentExpense,
    currentNet: sum(currentIncome) - currentExpense,
    previousExpense,
    hasPreviousMonthExpenses: previousExpenses.length > 0,
    monthChange:
      previousExpense > 0
        ? (currentExpense - previousExpense) / previousExpense
        : null,
    categoryTotals: categoryTotals.map(([category, amount]) => ({
      category,
      amount,
    })),
    largestExpense: largestExpense
      ? {
          amount: Number(largestExpense.amount),
          category: largestExpense.category || 'Other',
          merchant: largestExpense.merchant || '',
          date: formatTransactionDate(largestExpense.date),
        }
      : null,
    budgetUsage,
    overallBudget: overallBudget || null,
    hasTransactions: transactions.length > 0,
  };
}

function generateFinancialInsights(transactions, budgets = [], now = new Date()) {
  const summary = summarizeFinancialData(transactions, budgets, now);
  if (!summary.hasTransactions) {
    return {
      summary,
      insights: ['Add transactions to get insights based on your spending.'],
    };
  }

  const insights = [];
  const topCategory = summary.categoryTotals[0];
  if (topCategory) {
    insights.push(
      `${topCategory.category} is your highest spending category this month at ${currency(topCategory.amount)}.`,
    );
  }
  insights.push(
    `You spent ${currency(summary.currentExpense)} this month; recorded income is ${currency(summary.currentIncome)}, leaving a net ${summary.currentNet >= 0 ? 'surplus' : 'shortfall'} of ${currency(Math.abs(summary.currentNet))}.`,
  );
  if (summary.hasPreviousMonthExpenses) {
    const direction = summary.currentExpense > summary.previousExpense
      ? 'increased'
      : summary.currentExpense < summary.previousExpense
        ? 'decreased'
        : 'is unchanged';
    const difference = summary.monthChange == null
      ? ''
      : ` (${Math.abs(summary.monthChange * 100).toFixed(0)}%)`;
    insights.push(
      `Expenses ${direction}${difference} compared with last month (${currency(summary.previousExpense)} last month).`,
    );
  }
  if (summary.largestExpense) {
    const expense = summary.largestExpense;
    insights.push(
      `Your largest recorded expense is ${currency(expense.amount)}${expense.merchant ? ` at ${expense.merchant}` : ''} (${expense.category}) on ${expense.date}.`,
    );
  }
  if (summary.overallBudget) {
    const budget = summary.overallBudget;
    if (budget.remaining < 0) {
      insights.push(
        `Your monthly budget is exceeded by ${currency(Math.abs(budget.remaining))} (${(budget.percentUsed * 100).toFixed(0)}% used).`,
      );
    } else {
      insights.push(
        `You have ${currency(budget.remaining)} remaining from your ${currency(budget.amount)} monthly budget (${(budget.percentUsed * 100).toFixed(0)}% used).`,
      );
    }
  }
  for (const budget of summary.budgetUsage) {
    if (
      budget.category !== OVERALL_BUDGET_CATEGORY &&
      budget.amount > 0 &&
      budget.percentUsed >= 0.8
    ) {
      insights.push(
        `${budget.category} budget is ${budget.remaining < 0 ? 'exceeded' : 'at least 80% used'} (${(budget.percentUsed * 100).toFixed(0)}%).`,
      );
    }
  }
  return { summary, insights };
}

function answerFinancialQuestion(
  question,
  transactions,
  budgets = [],
  now = new Date(),
) {
  const summary = summarizeFinancialData(transactions, budgets, now);
  const lower = question.toLowerCase();
  if (!summary.hasTransactions && !summary.overallBudget) {
    return 'There are no saved transactions or budgets to calculate that yet. Add a transaction or set a monthly budget first.';
  }

  if (/budget|remaining|left to spend|limit/.test(lower)) {
    const budget = summary.overallBudget;
    if (!budget) {
      return 'You have not set an overall spending budget for this month yet. You can set one from Home → Monthly budget.';
    }
    if (budget.remaining < 0) {
      return `Your monthly budget is exceeded by ${currency(Math.abs(budget.remaining))}. You spent ${currency(budget.spent)} of ${currency(budget.amount)} (${(budget.percentUsed * 100).toFixed(0)}% used).`;
    }
    return `You have ${currency(budget.remaining)} remaining from your ${currency(budget.amount)} monthly budget. You have used ${(budget.percentUsed * 100).toFixed(0)}%.`;
  }

  if (/compare|last month|month.to.month/.test(lower)) {
    if (!summary.hasPreviousMonthExpenses) {
      return `You spent ${currency(summary.currentExpense)} this month. There are no saved expenses from last month to compare.`;
    }
    const direction = summary.currentExpense > summary.previousExpense
      ? 'more'
      : summary.currentExpense < summary.previousExpense
        ? 'less'
        : 'the same amount';
    return `You spent ${currency(summary.currentExpense)} this month and ${currency(summary.previousExpense)} last month. That is ${direction} this month.`;
  }

  if (/biggest|largest|highest expense|unusual|high.value/.test(lower)) {
    const expense = summary.largestExpense;
    return expense
      ? `Your largest recorded expense is ${currency(expense.amount)}${expense.merchant ? ` at ${expense.merchant}` : ''} (${expense.category}) on ${expense.date}.`
      : 'There are no saved expenses to identify a largest transaction.';
  }

  if (/reduce|cut|lower|category should/.test(lower)) {
    const top = summary.categoryTotals[0];
    return top
      ? `${top.category} is your highest spending category this month at ${currency(top.amount)}. If you want to reduce spending, reviewing this category is a data-based place to start.`
      : 'There are no saved expenses this month to identify a category to reduce.';
  }

  if (/where|most|category|spending by/.test(lower)) {
    const top = summary.categoryTotals[0];
    return top
      ? `You spent the most on ${top.category} this month: ${currency(top.amount)}.`
      : 'There are no saved expenses this month to rank by category.';
  }

  if (/income|net|balance|saving/.test(lower)) {
    return `This month, recorded income is ${currency(summary.currentIncome)} and expenses are ${currency(summary.currentExpense)}. Your net balance for the month is ${currency(summary.currentNet)}.`;
  }

  if (/spent|spend|expense|month/.test(lower)) {
    return `Your saved expenses this month total ${currency(summary.currentExpense)}.`;
  }

  return 'I can answer questions about this month’s spending, highest category or expense, budget remaining, income versus expenses, and comparison with last month.';
}

module.exports = {
  answerFinancialQuestion,
  generateFinancialInsights,
  summarizeFinancialData,
};

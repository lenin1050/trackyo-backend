const OVERALL_BUDGET_CATEGORY = 'Overall spending';

function calculateBudgetUsage(budget, transactions) {
  const spent = transactions
    .filter((item) => {
      if (item.type !== 'expense') return false;
      if (
        budget.category !== OVERALL_BUDGET_CATEGORY &&
        item.category !== budget.category
      ) {
        return false;
      }
      return new Date(item.date).toISOString().slice(0, 7) === budget.month;
    })
    .reduce((total, item) => total + Number(item.amount), 0);

  return {
    spent,
    remaining: Number(budget.amount) - spent,
    percentUsed: budget.amount ? spent / Number(budget.amount) : 0,
  };
}

module.exports = { OVERALL_BUDGET_CATEGORY, calculateBudgetUsage };

function summarize(items) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const current = items.filter(
    (item) => new Date(item.date) >= monthStart && new Date(item.date) < monthEnd,
  );
  const previous = items.filter(
    (item) =>
      new Date(item.date) >= new Date(now.getFullYear(), now.getMonth() - 1, 1) &&
      new Date(item.date) < monthStart,
  );
  const expenses = current.filter((item) => item.type === 'expense');
  const incomes = items.filter((item) => item.type === 'income');
  const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = items
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);
  const monthIncome = current
    .filter((item) => item.type === 'income')
    .reduce((sum, item) => sum + item.amount, 0);
  const expense = expenses.reduce((sum, item) => sum + item.amount, 0);
  const previousExpense = previous
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);
  const byCategory = {};
  for (const item of expenses) {
    byCategory[item.category] = (byCategory[item.category] || 0) + item.amount;
  }
  const byIncomeSource = {};
  for (const item of incomes) {
    const source = item.incomeSource || item.category || 'Other';
    byIncomeSource[source] = (byIncomeSource[source] || 0) + item.amount;
  }
  const highestExpense =
    [...items.filter((item) => item.type === 'expense')].sort(
      (a, b) => b.amount - a.amount,
    )[0] || null;
  const daysElapsed = Math.max(1, now.getDate());

  return {
    totalIncome,
    totalExpense,
    savings: totalIncome - totalExpense,
    monthIncome,
    monthSavings: monthIncome - expense,
    monthlyExpense: expense,
    averageDailyExpense: expense / daysElapsed,
    averageMonthlyExpense:
      items
        .filter((item) => item.type === 'expense')
        .reduce((sum, item) => sum + item.amount, 0) /
      Math.max(
        1,
        new Set(
          items
            .filter((item) => item.type === 'expense')
            .map((item) => new Date(item.date).toISOString().slice(0, 7)),
        ).size,
      ),
    previousMonthExpense: previousExpense,
    monthChange: previousExpense ? (expense - previousExpense) / previousExpense : null,
    categoryTotals: Object.entries(byCategory)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total),
    incomeSourceTotals: Object.entries(byIncomeSource)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total),
    highestCategory:
      Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    highestExpense: highestExpense
      ? {
          amount: highestExpense.amount,
          category: highestExpense.category,
          merchant: highestExpense.merchant,
          date: highestExpense.date,
        }
      : null,
  };
}

module.exports = { summarize };

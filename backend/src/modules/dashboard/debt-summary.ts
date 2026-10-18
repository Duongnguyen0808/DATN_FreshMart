type DebtRow = { totalAmount: unknown; paidAmount: unknown; dueDate: Date };

export function summarizeDebt(rows: DebtRow[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return rows.reduce((summary, row) => {
    const outstanding = Math.max(0, Number(row.totalAmount) - Number(row.paidAmount));
    summary.outstanding += outstanding;
    if (outstanding > 0 && row.dueDate < startOfToday) {
      summary.overdue += outstanding;
      summary.overdueCount++;
    }
    return summary;
  }, { outstanding: 0, overdue: 0, overdueCount: 0 });
}

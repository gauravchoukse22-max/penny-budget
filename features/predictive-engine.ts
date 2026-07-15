// ---------------------------------------------------------------------------
// features/predictive-engine.ts – Forecasting & anomaly detection for Penny
// Budget.
//
// All functions are async and use getDb() for database access.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import type { Category, Transaction } from '../lib/models';
import type {
  AnomalyAlert,
  CategoryProjection,
  MonthlySummary,
} from './models';

// ---- helpers ---------------------------------------------------------------

/** Shift a "YYYY-MM" string by `delta` months. */
function shiftYearMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Current year-month as "YYYY-MM". */
function currentYearMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Days remaining in a month (including today). */
function daysLeftInMonth(yearMonth: string, today = new Date()): number {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // last day of the month

  // If the yearMonth is the current month, use today's date
  const currentYm = currentYearMonth(today);
  if (yearMonth === currentYm) {
    return Math.max(1, lastDay - today.getDate() + 1);
  }
  // For future months, return total days; for past months, return 0
  if (yearMonth > currentYm) return lastDay;
  return 1; // avoid division by zero for past months
}

// ---- 1. Historical Category Projections ------------------------------------

/**
 * For each category, calculate an EMA-weighted average of monthly spend over
 * the last `lookbackMonths` completed months (α = 0.3, most recent weighted
 * heavier).  Compare to current-month spend to determine projection status.
 */
export async function getHistoricalCategoryProjections(
  lookbackMonths = 3,
): Promise<CategoryProjection[]> {
  const db = await getDb();
  const now = currentYearMonth();
  const alpha = 0.3;

  // Fetch all categories
  const categories = await db.getAllAsync<Category>(
    'SELECT * FROM categories',
  );

  // Resolve per-month budget limits (carry-forward logic)
  const limitRows = await db.getAllAsync<{
    categoryId: string;
    monthlyLimit: number;
    yearMonth: string;
  }>(
    'SELECT categoryId, monthlyLimit, yearMonth FROM category_budgets WHERE yearMonth <= ? ORDER BY yearMonth ASC',
    [now],
  );
  const latestLimits = new Map<string, number>();
  for (const r of limitRows) latestLimits.set(r.categoryId, r.monthlyLimit);

  const projections: CategoryProjection[] = [];

  for (const cat of categories) {
    // Gather completed months' spend (most recent first)
    const monthlySpends: number[] = [];
    for (let i = 1; i <= lookbackMonths; i++) {
      const ym = shiftYearMonth(now, -i);
      const row = await db.getFirstAsync<{ total: number | null }>(
        `SELECT SUM(amount) as total FROM transactions
         WHERE categoryId = ? AND date LIKE ?`,
        [cat.id, `${ym}%`],
      );
      monthlySpends.push(row?.total ?? 0);
    }

    // EMA: iterate from oldest to newest so the most recent value has the
    // strongest weight.
    monthlySpends.reverse(); // now oldest-first
    let ema = monthlySpends[0] ?? 0;
    for (let i = 1; i < monthlySpends.length; i++) {
      ema = alpha * monthlySpends[i] + (1 - alpha) * ema;
    }

    // Current month spend
    const currentRow = await db.getFirstAsync<{ total: number | null }>(
      `SELECT SUM(amount) as total FROM transactions
       WHERE categoryId = ? AND date LIKE ?`,
      [cat.id, `${now}%`],
    );
    const currentSpend = currentRow?.total ?? 0;

    // Project final spend: scale current spend by proportion of month elapsed
    const [y, m] = now.split('-').map(Number);
    const totalDays = new Date(y, m, 0).getDate();
    const today = new Date();
    const dayOfMonth = today.getDate();
    const projectedFinalSpend =
      dayOfMonth > 0 ? (currentSpend / dayOfMonth) * totalDays : ema;

    const budgetLimit = latestLimits.get(cat.id) ?? cat.monthlyLimit;

    // Status thresholds
    let status: CategoryProjection['status'] = 'on_track';
    if (budgetLimit > 0) {
      const ratio = projectedFinalSpend / budgetLimit;
      if (ratio > 1.0) status = 'over_budget';
      else if (ratio >= 0.8) status = 'warning';
    }

    projections.push({
      categoryId: cat.id,
      historicalAverage: ema,
      currentSpend,
      projectedFinalSpend,
      budgetLimit,
      status,
    });
  }

  return projections;
}

// ---- 2. Anomaly Detection --------------------------------------------------

/**
 * For each transaction in the given month, calculate the mean and standard
 * deviation of past transactions in the same category.  Flag transactions
 * where (amount − mean) > 2 × stdDev.
 *
 * Severity:
 *   • z-score 2.0–2.5 → 'info'
 *   • z-score 2.5–3.0 → 'warning'
 *   • z-score > 3.0   → 'critical'
 */
export async function detectAnomalies(
  yearMonth: string,
): Promise<AnomalyAlert[]> {
  const db = await getDb();

  // All transactions for the target month
  const transactions = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE date LIKE ?`,
    [`${yearMonth}%`],
  );

  // Fetch category names for human-readable explanations
  const categories = await db.getAllAsync<Category>(
    'SELECT * FROM categories',
  );
  const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

  const alerts: AnomalyAlert[] = [];

  for (const tx of transactions) {
    if (!tx.categoryId) continue;

    // Historical transactions in the same category (excluding this month)
    const historical = await db.getAllAsync<{ amount: number }>(
      `SELECT amount FROM transactions
       WHERE categoryId = ? AND date NOT LIKE ?`,
      [tx.categoryId, `${yearMonth}%`],
    );

    if (historical.length < 5) continue; // need enough data

    const amounts = historical.map((r) => r.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance =
      amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) continue;

    const zScore = (tx.amount - mean) / stdDev;

    if (zScore > 2.0) {
      let severity: AnomalyAlert['severity'] = 'info';
      if (zScore > 3.0) severity = 'critical';
      else if (zScore > 2.5) severity = 'warning';

      const catName = catNameMap.get(tx.categoryId) ?? 'this category';

      alerts.push({
        transactionId: tx.id,
        note: tx.note,
        amount: tx.amount,
        categoryId: tx.categoryId,
        averageForCategory: Math.round(mean * 100) / 100,
        stdDeviation: Math.round(stdDev * 100) / 100,
        severity,
        explanation: `This $${tx.amount.toFixed(2)} charge is unusually high. You typically spend ~$${mean.toFixed(2)} on ${catName}.`,
      });
    }
  }

  return alerts;
}

// ---- 3. "In My Pocket" calculation -----------------------------------------

/**
 * How much discretionary money is left for the rest of the month:
 *
 *   salary − totalSpent − upcomingBillsRemaining − transferredSavings
 *
 * Upcoming bills = recurring_transactions where nextPostDate falls within
 * this month and the date hasn't passed yet.
 */
export async function getInMyPocket(yearMonth: string): Promise<number> {
  const db = await getDb();

  // Salary
  const settings = await db.getFirstAsync<{
    salaryMode: string;
    fixedSalary: number;
  }>('SELECT salaryMode, fixedSalary FROM app_settings WHERE id = 1');

  let salary = settings?.fixedSalary ?? 0;
  if (settings?.salaryMode === 'variable') {
    const monthly = await db.getFirstAsync<{ salary: number }>(
      'SELECT salary FROM monthly_settings WHERE yearMonth = ?',
      [yearMonth],
    );
    salary = monthly?.salary ?? 0;
  }

  // Total spent
  const spentRow = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount) as total FROM transactions WHERE date LIKE ?',
    [`${yearMonth}%`],
  );
  const totalSpent = spentRow?.total ?? 0;

  // Upcoming bills remaining (not yet posted this month)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const upcomingRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM recurring_transactions
     WHERE active = 1 AND nextPostDate LIKE ? AND nextPostDate > ?`,
    [`${yearMonth}%`, todayStr],
  );
  const upcomingBills = upcomingRow?.total ?? 0;

  // Transferred savings
  const savingsRow = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(
       COALESCE(sgb.monthlyAmount, sg.monthlyAmount)
     ) as total
     FROM savings_goal_transfers sgt
     JOIN savings_goals sg ON sg.id = sgt.goalId
     LEFT JOIN savings_goal_budgets sgb
       ON sgb.goalId = sgt.goalId
       AND sgb.yearMonth = sgt.yearMonth
     WHERE sgt.yearMonth = ? AND sgt.transferred = 1`,
    [yearMonth],
  );
  const transferredSavings = savingsRow?.total ?? 0;

  return salary - totalSpent - upcomingBills - transferredSavings;
}

// ---- 4. Safe-to-Spend Per Day ----------------------------------------------

/**
 * For the overall budget:
 *   (salary − totalSpent − upcomingBills − savings) / daysLeftInMonth
 */
export async function getSafeToSpendPerDay(
  yearMonth: string,
): Promise<number> {
  const remaining = await getInMyPocket(yearMonth);
  const daysLeft = daysLeftInMonth(yearMonth);
  return Math.max(0, remaining / daysLeft);
}

// ---- 5. Seasonal Adjustment ------------------------------------------------

/**
 * Look at the same calendar month in prior years.  If data exists, return the
 * ratio vs. the annual average (e.g. 1.4 = 40% higher than average for this
 * month).
 *
 * Returns null if fewer than 2 data points (years) are available.
 */
export async function getSeasonalAdjustment(
  categoryId: string,
  targetMonth: number, // 1-12
): Promise<number | null> {
  const db = await getDb();

  // All monthly totals for this category, grouped by year-month
  const rows = await db.getAllAsync<{ ym: string; total: number }>(
    `SELECT substr(date, 1, 7) as ym, SUM(amount) as total
     FROM transactions
     WHERE categoryId = ?
     GROUP BY ym
     ORDER BY ym ASC`,
    [categoryId],
  );

  if (rows.length < 2) return null;

  // Calculate overall monthly average
  const overallAvg =
    rows.reduce((s, r) => s + r.total, 0) / rows.length;

  if (overallAvg === 0) return null;

  // Filter to the target month across years
  const targetMonthStr = String(targetMonth).padStart(2, '0');
  const sameMonth = rows.filter((r) => r.ym.endsWith(`-${targetMonthStr}`));

  if (sameMonth.length === 0) return null;

  const targetAvg =
    sameMonth.reduce((s, r) => s + r.total, 0) / sameMonth.length;

  return Math.round((targetAvg / overallAvg) * 100) / 100;
}

// ---- 6. Monthly Summary ---------------------------------------------------

/**
 * Generate a high-level summary for a completed (or in-progress) month:
 *   • Total spent
 *   • Top 3 categories by spend
 *   • Biggest single purchase
 *   • Transaction count
 *   • Budget score (0-100): percentage of categories that stayed within budget
 */
export async function generateMonthlySummary(
  yearMonth: string,
): Promise<MonthlySummary> {
  const db = await getDb();

  // All transactions for the month
  const transactions = await db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE date LIKE ? ORDER BY amount DESC',
    [`${yearMonth}%`],
  );

  const totalSpent = transactions.reduce((s, t) => s + t.amount, 0);
  const transactionCount = transactions.length;

  // Biggest purchase
  const biggestPurchase =
    transactions.length > 0
      ? { note: transactions[0].note, amount: transactions[0].amount }
      : null;

  // Top categories
  const categories = await db.getAllAsync<Category>(
    'SELECT * FROM categories',
  );
  const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

  const spendByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (!t.categoryId) continue;
    spendByCategory.set(
      t.categoryId,
      (spendByCategory.get(t.categoryId) ?? 0) + t.amount,
    );
  }

  const topCategories = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, total]) => ({
      categoryId,
      name: catNameMap.get(categoryId) ?? 'Unknown',
      total,
    }));

  // Budget score: percentage of categories that are at or under budget
  // Resolve budget limits (carry-forward)
  const limitRows = await db.getAllAsync<{
    categoryId: string;
    monthlyLimit: number;
  }>(
    'SELECT categoryId, monthlyLimit FROM category_budgets WHERE yearMonth <= ? ORDER BY yearMonth ASC',
    [yearMonth],
  );
  const latestLimits = new Map<string, number>();
  for (const r of limitRows) latestLimits.set(r.categoryId, r.monthlyLimit);

  let categoriesWithBudget = 0;
  let categoriesWithinBudget = 0;

  for (const cat of categories) {
    const limit = latestLimits.get(cat.id) ?? cat.monthlyLimit;
    if (limit <= 0) continue; // skip categories with no budget
    categoriesWithBudget++;
    const spent = spendByCategory.get(cat.id) ?? 0;
    if (spent <= limit) categoriesWithinBudget++;
  }

  const budgetScore =
    categoriesWithBudget > 0
      ? Math.round((categoriesWithinBudget / categoriesWithBudget) * 100)
      : 100;

  return {
    yearMonth,
    totalSpent,
    topCategories,
    biggestPurchase,
    transactionCount,
    budgetScore,
  };
}

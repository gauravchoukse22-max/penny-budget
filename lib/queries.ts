import { getDb } from './db';
import { uuid } from './uuid';
import type {
  AppSettings,
  BudgetStatus,
  Card,
  Category,
  CategorySpendSummary,
  MonthlySettings,
  SavingsGoal,
  SavingsGoalTransfer,
  Transaction,
  TrendPoint,
} from './models';

// ---------- Settings ----------

export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    currency: string;
    salaryMode: 'fixed' | 'variable';
    fixedSalary: number;
    onboarded: number;
  }>('SELECT currency, salaryMode, fixedSalary, onboarded FROM app_settings WHERE id = 1');
  return {
    currency: row?.currency ?? 'USD',
    salaryMode: row?.salaryMode ?? 'fixed',
    fixedSalary: row?.fixedSalary ?? 0,
    onboarded: !!row?.onboarded,
  };
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const db = await getDb();
  const current = await getAppSettings();
  const next = { ...current, ...patch };
  await db.runAsync('UPDATE app_settings SET currency = ?, salaryMode = ?, fixedSalary = ?, onboarded = ? WHERE id = 1', [
    next.currency,
    next.salaryMode,
    next.fixedSalary,
    next.onboarded ? 1 : 0,
  ]);
}

// ---------- Cards ----------

export async function listCards(): Promise<Card[]> {
  const db = await getDb();
  return db.getAllAsync<Card>('SELECT * FROM cards ORDER BY sortOrder ASC');
}

export async function createCard(input: Omit<Card, 'id' | 'sortOrder' | 'billDay' | 'dueDay'> & Partial<Pick<Card, 'billDay' | 'dueDay'>>): Promise<Card> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM cards');
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  const card: Card = { id: uuid(), sortOrder, billDay: null, dueDay: null, ...input };
  await db.runAsync('INSERT INTO cards (id, name, lastFour, color, sortOrder, billDay, dueDay) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    card.id,
    card.name,
    card.lastFour,
    card.color,
    card.sortOrder,
    card.billDay,
    card.dueDay,
  ]);
  return card;
}

export async function updateCard(id: string, patch: Partial<Omit<Card, 'id'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Card>('SELECT * FROM cards WHERE id = ?', [id]);
  if (!existing) return;
  const next = { ...existing, ...patch };
  await db.runAsync('UPDATE cards SET name = ?, lastFour = ?, color = ?, sortOrder = ?, billDay = ?, dueDay = ? WHERE id = ?', [
    next.name,
    next.lastFour,
    next.color,
    next.sortOrder,
    next.billDay,
    next.dueDay,
    id,
  ]);
}

/** Days until a card's next due date (day-of-month), or null if not tracked. Wraps to next month if the day already passed. */
export function daysUntilDue(dueDay: number | null, today = new Date()): number | null {
  if (!dueDay) return null;
  const candidate = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return Math.round((candidate.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
}

export async function deleteCard(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
}

// ---------- Categories ----------

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>('SELECT * FROM categories ORDER BY sortOrder ASC');
}

export async function createCategory(input: Omit<Category, 'id' | 'sortOrder'>): Promise<Category> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM categories');
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  const category: Category = { id: uuid(), sortOrder, ...input };
  await db.runAsync('INSERT INTO categories (id, name, icon, color, monthlyLimit, sortOrder) VALUES (?, ?, ?, ?, ?, ?)', [
    category.id,
    category.name,
    category.icon,
    category.color,
    category.monthlyLimit,
    category.sortOrder,
  ]);
  return category;
}

export async function updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Category>('SELECT * FROM categories WHERE id = ?', [id]);
  if (!existing) return;
  const next = { ...existing, ...patch };
  await db.runAsync('UPDATE categories SET name = ?, icon = ?, color = ?, monthlyLimit = ?, sortOrder = ? WHERE id = ?', [
    next.name,
    next.icon,
    next.color,
    next.monthlyLimit,
    next.sortOrder,
    id,
  ]);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
}

// ---------- Savings Goals ----------

export async function listSavingsGoals(): Promise<SavingsGoal[]> {
  const db = await getDb();
  return db.getAllAsync<SavingsGoal>('SELECT * FROM savings_goals ORDER BY sortOrder ASC');
}

export async function createSavingsGoal(input: Omit<SavingsGoal, 'id' | 'sortOrder'>): Promise<SavingsGoal> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM savings_goals');
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  const goal: SavingsGoal = { id: uuid(), sortOrder, ...input };
  await db.runAsync('INSERT INTO savings_goals (id, name, monthlyAmount, sortOrder) VALUES (?, ?, ?, ?)', [
    goal.id,
    goal.name,
    goal.monthlyAmount,
    goal.sortOrder,
  ]);
  return goal;
}

export async function updateSavingsGoal(id: string, patch: Partial<Omit<SavingsGoal, 'id'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<SavingsGoal>('SELECT * FROM savings_goals WHERE id = ?', [id]);
  if (!existing) return;
  const next = { ...existing, ...patch };
  await db.runAsync('UPDATE savings_goals SET name = ?, monthlyAmount = ?, sortOrder = ? WHERE id = ?', [
    next.name,
    next.monthlyAmount,
    next.sortOrder,
    id,
  ]);
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM savings_goals WHERE id = ?', [id]);
}

export function resolvedGoalAmount(goal: SavingsGoal, overrides?: Map<string, number>): number {
  return overrides?.get(goal.id) ?? goal.monthlyAmount;
}

export function totalSavingsGoals(goals: SavingsGoal[], overrides?: Map<string, number>): number {
  return goals.reduce((sum, g) => sum + resolvedGoalAmount(g, overrides), 0);
}

/** Sum of only the goals actually marked "transferred" for a given month — a
 * goal's target amount shouldn't count as saved money until it's real. */
export function totalTransferredSavings(
  goals: SavingsGoal[],
  transferStatus: Map<string, boolean>,
  overrides?: Map<string, number>
): number {
  return goals.reduce((sum, g) => sum + (transferStatus.get(g.id) ? resolvedGoalAmount(g, overrides) : 0), 0);
}

// ---------- Per-month budget snapshots (category limits & savings amounts) ----------

/**
 * Resolves each category's monthly limit as of `yearMonth`, carrying forward
 * the most recent snapshot at-or-before that month. Falls back to the
 * category's own `monthlyLimit` (its value when created) if no snapshot
 * exists yet at or before that month — so editing this month's budget never
 * rewrites what a past month's budget actually was.
 */
export async function resolveCategoryLimits(yearMonth: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ categoryId: string; monthlyLimit: number }>(
    'SELECT categoryId, monthlyLimit FROM category_budgets WHERE yearMonth <= ? ORDER BY yearMonth ASC',
    [yearMonth]
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.categoryId, r.monthlyLimit); // later (larger) yearMonth overwrites earlier
  return map;
}

/** Sets a category's budget for this month forward (until a newer snapshot exists). */
export async function setCategoryLimitForMonth(categoryId: string, yearMonth: string, monthlyLimit: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO category_budgets (id, categoryId, yearMonth, monthlyLimit) VALUES (?, ?, ?, ?)
     ON CONFLICT (categoryId, yearMonth) DO UPDATE SET monthlyLimit = excluded.monthlyLimit`,
    [uuid(), categoryId, yearMonth, monthlyLimit]
  );
}

/** Same carry-forward semantics as resolveCategoryLimits, for savings goal amounts. */
export async function resolveSavingsGoalAmounts(yearMonth: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ goalId: string; monthlyAmount: number }>(
    'SELECT goalId, monthlyAmount FROM savings_goal_budgets WHERE yearMonth <= ? ORDER BY yearMonth ASC',
    [yearMonth]
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.goalId, r.monthlyAmount);
  return map;
}

export async function setSavingsGoalAmountForMonth(goalId: string, yearMonth: string, monthlyAmount: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO savings_goal_budgets (id, goalId, yearMonth, monthlyAmount) VALUES (?, ?, ?, ?)
     ON CONFLICT (goalId, yearMonth) DO UPDATE SET monthlyAmount = excluded.monthlyAmount`,
    [uuid(), goalId, yearMonth, monthlyAmount]
  );
}

// ---------- Savings goal monthly transfer checklist ----------

/** Mirrors the "Transfers this month" checklist: has each goal's transfer been done this month? */
export async function listTransferStatus(yearMonth: string): Promise<Map<string, boolean>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ goalId: string; transferred: number }>(
    'SELECT goalId, transferred FROM savings_goal_transfers WHERE yearMonth = ?',
    [yearMonth]
  );
  return new Map(rows.map((r) => [r.goalId, !!r.transferred]));
}

export async function setTransferStatus(goalId: string, yearMonth: string, transferred: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO savings_goal_transfers (id, goalId, yearMonth, transferred) VALUES (?, ?, ?, ?)
     ON CONFLICT (goalId, yearMonth) DO UPDATE SET transferred = excluded.transferred`,
    [uuid(), goalId, yearMonth, transferred ? 1 : 0]
  );
}

// ---------- Monthly Settings (variable salary) ----------

export async function getMonthlySettings(yearMonth: string): Promise<MonthlySettings | null> {
  const db = await getDb();
  return db.getFirstAsync<MonthlySettings>('SELECT * FROM monthly_settings WHERE yearMonth = ?', [yearMonth]);
}

export async function setMonthlySalary(yearMonth: string, salary: number): Promise<void> {
  const db = await getDb();
  const existing = await getMonthlySettings(yearMonth);
  if (existing) {
    await db.runAsync('UPDATE monthly_settings SET salary = ? WHERE yearMonth = ?', [salary, yearMonth]);
  } else {
    await db.runAsync('INSERT INTO monthly_settings (id, yearMonth, salary) VALUES (?, ?, ?)', [uuid(), yearMonth, salary]);
  }
}

/** Resolves the salary to use for a given month, per the fixed/variable setting. */
export async function resolveSalaryForMonth(yearMonth: string): Promise<number> {
  const settings = await getAppSettings();
  if (settings.salaryMode === 'fixed') return settings.fixedSalary;
  const monthly = await getMonthlySettings(yearMonth);
  return monthly?.salary ?? 0;
}

// ---------- Transactions ----------

export async function listTransactionsForMonth(yearMonth: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>('SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, createdAt DESC', [
    `${yearMonth}%`,
  ]);
}

export async function listUncategorizedTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>('SELECT * FROM transactions WHERE categoryId IS NULL ORDER BY date DESC');
}

export async function listAllTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>('SELECT * FROM transactions ORDER BY date DESC, createdAt DESC');
}

export async function createTransaction(
  input: Omit<Transaction, 'id' | 'createdAt' | 'source'> & { source?: Transaction['source'] }
): Promise<Transaction> {
  const db = await getDb();
  const tx: Transaction = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    source: input.source ?? 'manual',
    ...input,
  };
  await db.runAsync(
    'INSERT INTO transactions (id, amount, date, categoryId, cardId, note, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [tx.id, tx.amount, tx.date, tx.categoryId, tx.cardId, tx.note, tx.source, tx.createdAt]
  );
  return tx;
}

export async function updateTransaction(id: string, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!existing) return;
  const next = { ...existing, ...patch };
  await db.runAsync('UPDATE transactions SET amount = ?, date = ?, categoryId = ?, cardId = ?, note = ?, source = ? WHERE id = ?', [
    next.amount,
    next.date,
    next.categoryId,
    next.cardId,
    next.note,
    next.source,
    id,
  ]);
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

// ---------- Core calculations (spec Section 5) ----------

export function sumAmount(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

/** 5.1 Monthly Surplus = Salary − SUM(transactions) − SUM(savings goals) */
export async function computeSurplus(yearMonth: string): Promise<{ salary: number; spend: number; savings: number; surplus: number }> {
  const [salary, transactions, goals, transferStatus, goalAmounts] = await Promise.all([
    resolveSalaryForMonth(yearMonth),
    listTransactionsForMonth(yearMonth),
    listSavingsGoals(),
    listTransferStatus(yearMonth),
    resolveSavingsGoalAmounts(yearMonth),
  ]);
  const spend = sumAmount(transactions);
  const savings = totalTransferredSavings(goals, transferStatus, goalAmounts);
  return { salary, spend, savings, surplus: salary - spend - savings };
}

/** 5.2 + 5.3 Category spend + budget health, sorted worst-to-best. Each
 * category's limit is resolved as of `yearMonth` (see resolveCategoryLimits)
 * so past months keep the budget they actually had, not today's numbers. */
export async function computeCategorySummaries(yearMonth: string): Promise<CategorySpendSummary[]> {
  const [categories, transactions, limitOverrides] = await Promise.all([
    listCategories(),
    listTransactionsForMonth(yearMonth),
    resolveCategoryLimits(yearMonth),
  ]);
  const spendByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (!t.categoryId) continue;
    spendByCategory.set(t.categoryId, (spendByCategory.get(t.categoryId) ?? 0) + t.amount);
  }
  const summaries: CategorySpendSummary[] = categories.map((category) => {
    const monthlyLimit = limitOverrides.get(category.id) ?? category.monthlyLimit;
    const spend = spendByCategory.get(category.id) ?? 0;
    const remaining = monthlyLimit - spend;
    const percent = monthlyLimit > 0 ? (spend / monthlyLimit) * 100 : 0;
    let status: BudgetStatus = 'green';
    if (percent > 100) status = 'red';
    else if (percent >= 80) status = 'amber';
    return { category: { ...category, monthlyLimit }, spend, remaining, status, percent };
  });
  return summaries.sort((a, b) => b.percent - a.percent);
}

/** 5.4 Card totals for the month. */
export async function computeCardTotals(yearMonth: string): Promise<Map<string, number>> {
  const transactions = await listTransactionsForMonth(yearMonth);
  const totals = new Map<string, number>();
  for (const t of transactions) {
    totals.set(t.cardId, (totals.get(t.cardId) ?? 0) + t.amount);
  }
  return totals;
}

function shiftYearMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(yearMonth: string, delta: number): string {
  return shiftYearMonth(yearMonth, delta);
}

/** 5.5 Trend series for the last N months (oldest first). */
export async function computeTrendSeries(endYearMonth: string, months = 6): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = shiftYearMonth(endYearMonth, -i);
    const { spend, surplus } = await computeSurplus(ym);
    points.push({ yearMonth: ym, totalSpend: spend, surplus });
  }
  return points;
}

export async function computeCategoryTrend(categoryId: string, endYearMonth: string, months = 6): Promise<TrendPoint[]> {
  const points: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = shiftYearMonth(endYearMonth, -i);
    const transactions = await listTransactionsForMonth(ym);
    const spend = transactions.filter((t) => t.categoryId === categoryId).reduce((s, t) => s + t.amount, 0);
    points.push({ yearMonth: ym, totalSpend: spend, surplus: 0 });
  }
  return points;
}

// ---------- CSV export/import ----------

export function transactionsToCsv(transactions: Transaction[], categories: Category[], cards: Card[]): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const header = 'date,amount,category,card,note,source';
  const rows = transactions.map((t) => {
    const fields = [
      t.date,
      t.amount.toString(),
      t.categoryId ? catName.get(t.categoryId) ?? '' : '',
      cardName.get(t.cardId) ?? '',
      t.note ?? '',
      t.source,
    ];
    return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

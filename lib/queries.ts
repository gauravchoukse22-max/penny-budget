import { getDb, currentYearMonth } from './db';
import { uuid } from './uuid';
import { queueSyncMutation } from '../features/cloudkit-sync';
// One-way edge: features/funds.ts owns every fund_entries write (and its
// journaling) and imports nothing from here, so this cannot become a cycle.
import { reconcileSavingsGoalEntries } from '../features/funds';
// Same one-way edge: features/shared-settings.ts reads app_settings straight
// from the database rather than through getAppSettings, precisely so importing
// it here cannot become a cycle.
import { resolveDisplayCurrency, setSharedCurrency } from '../features/shared-settings';
import {
  CASH_CARD_COLOR,
  CASH_CARD_ID,
  CASH_CARD_NAME,
  CASH_CARD_SORT_ORDER,
} from './models';
import { categoryAmounts, splitId, type SplitPart } from './transaction-splits';
import { rolloversInto, type MonthLedger, type RolloverInput } from './rollover';
import type {
  AppSettings,
  BudgetStatus,
  Card,
  Category,
  CategoryMover,
  CategorySpendSummary,
  MonthlySettings,
  SavingsGoal,
  SavingsGoalTransfer,
  Transaction,
  TransactionSplit,
  TrendPoint,
} from './models';

// ---------- Sync journaling ----------

/** Splits an id list into `IN (...)`-safe batches; see journalRowsAsUpdates. */
export function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
  return chunks;
}

/**
 * Journals every named row of `table` as an UPDATE, reading the rows back so the
 * payload is what actually landed rather than what the caller intended.
 *
 * Chunked because SQLite caps bound parameters (999 on older builds) and a card
 * that has been in use for a couple of years can easily hold more transactions
 * than that — the one case where losing the journal would matter most.
 */
export async function journalRowsAsUpdates(table: string, ids: string[]): Promise<void> {
  const db = await getDb();
  for (const chunk of chunkIds(ids)) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id IN (${chunk.map(() => '?').join(', ')})`,
      chunk
    );
    for (const row of rows) await queueSyncMutation('UPDATE', table, row.id as string, row);
  }
}

// ---------- Settings ----------

/**
 * This device's OWN settings row, exactly as stored — nothing resolved.
 *
 * The write path must use this, not getAppSettings: getAppSettings hands back
 * the household's currency when there is one, and updateAppSettings writes the
 * whole row back, so reading the resolved value there would quietly overwrite
 * this device's own preference with the shared one. It would then be gone for
 * good — it is the value the user gets back when they leave the household.
 */
export async function getLocalAppSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    currency: string;
    salaryMode: 'fixed' | 'variable';
    fixedSalary: number;
    onboarded: number;
    biometricLock: number;
    cloudSyncEnabled: number;
    autoLockGraceMinutes: number;
    hideAmounts: number;
    householdId: string | null;
    insightsLayout: string | null;
    watchedCategories: string | null;
  }>('SELECT currency, salaryMode, fixedSalary, onboarded, biometricLock, cloudSyncEnabled, autoLockGraceMinutes, hideAmounts, householdId, insightsLayout, watchedCategories FROM app_settings WHERE id = 1');
  return {
    currency: row?.currency ?? 'USD',
    salaryMode: row?.salaryMode ?? 'fixed',
    fixedSalary: row?.fixedSalary ?? 0,
    onboarded: !!row?.onboarded,
    biometricLock: !!row?.biometricLock,
    cloudSyncEnabled: !!row?.cloudSyncEnabled,
    autoLockGraceMinutes: row?.autoLockGraceMinutes ?? 1,
    hideAmounts: !!row?.hideAmounts,
    householdId: row?.householdId ?? null,
    insightsLayout: row?.insightsLayout ?? null,
    watchedCategories: row?.watchedCategories ?? null,
  };
}

/**
 * The settings the APP should render with.
 *
 * Identical to the stored row except for the currency, which is a property of
 * the BUDGET rather than of the phone — exactly the argument made on
 * resolveSalaryForMonth below, and the same fix. app_settings deliberately never
 * syncs (it also holds the biometric lock and the household id), so a household
 * takes its currency from the shared record whenever one exists and two members
 * stop seeing $6,000 and £6,000 for the same number. With no household this is
 * a passthrough and a solo user is completely unaffected.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const local = await getLocalAppSettings();
  return { ...local, currency: await resolveDisplayCurrency(local.currency, local.householdId) };
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const db = await getDb();
  // getLocalAppSettings, NOT getAppSettings — see the note on it. Reading the
  // resolved currency here would write the household's value over this device's
  // own on the next unrelated settings change.
  const current = await getLocalAppSettings();
  const next = { ...current, ...patch };
  await db.runAsync(
    'UPDATE app_settings SET currency = ?, salaryMode = ?, fixedSalary = ?, onboarded = ?, biometricLock = ?, cloudSyncEnabled = ?, autoLockGraceMinutes = ?, hideAmounts = ?, householdId = ?, insightsLayout = ?, watchedCategories = ? WHERE id = 1',
    [
      next.currency,
      next.salaryMode,
      next.fixedSalary,
      next.onboarded ? 1 : 0,
      next.biometricLock ? 1 : 0,
      next.cloudSyncEnabled ? 1 : 0,
      next.autoLockGraceMinutes ?? 1,
      next.hideAmounts ? 1 : 0,
      next.householdId ?? null,
      next.insightsLayout ?? null,
      next.watchedCategories ?? null,
    ]
  );

  // Mirror a fixed salary into the shared month record so co-members see the
  // same "left to spend". Without this the number only ever changes on the
  // phone that typed it — see resolveSalaryForMonth.
  if (next.householdId && next.salaryMode === 'fixed' && patch.fixedSalary !== undefined) {
    await setMonthlySalary(currentYearMonth(), next.fixedSalary);
  }

  // Mirror the currency into the shared record, exactly as the salary above is
  // mirrored and for the same reason: it labels numbers BOTH members read, so
  // one phone changing it and the other not is the two of them disagreeing
  // about what the same figure means.
  //
  // Guarded on `patch.currency !== undefined` rather than on the value: this
  // must fire only when the user actually picked a currency. Firing on every
  // settings write would let a device that had merely joined push its own value
  // over the household's the next time anything at all changed — the silent
  // rewrite the join path deliberately refuses to do.
  if (next.householdId && patch.currency !== undefined) {
    await setSharedCurrency(next.householdId, next.currency);
  }
}

// ---------- Cards ----------

export async function listCards(): Promise<Card[]> {
  const db = await getDb();
  return db.getAllAsync<Card>('SELECT * FROM cards ORDER BY sortOrder ASC');
}

export async function createCard(input: Omit<Card, 'id' | 'sortOrder' | 'billDay' | 'dueDay'> & Partial<Pick<Card, 'billDay' | 'dueDay'>>): Promise<Card> {
  const db = await getDb();
  // Excludes Cash, whose sortOrder is a huge sentinel that pins it to the end of
  // the list. Counting it here would hand the next real card sortOrder 1000001
  // and push every new card past Cash instead of before it.
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sortOrder) as maxOrder FROM cards WHERE id != ?',
    [CASH_CARD_ID]
  );
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
  await queueSyncMutation('CREATE', 'cards', card.id, card);
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
  await queueSyncMutation('UPDATE', 'cards', id, next);
}

/** Days until a card's next due date (day-of-month), or null if not tracked. Wraps to next month if the day already passed. */
export function daysUntilDue(dueDay: number | null, today = new Date()): number | null {
  if (!dueDay) return null;
  const y = today.getFullYear();
  const mo = today.getMonth();
  // Clamp the requested day to the target month's length so e.g. "the 31st"
  // resolves to Apr 30 / Feb 28, not an overflow into the following month.
  const clampDay = (year: number, month: number, day: number) =>
    Math.min(day, new Date(year, month + 1, 0).getDate());
  const startOfToday = new Date(y, mo, today.getDate());
  let candidate = new Date(y, mo, clampDay(y, mo, dueDay));
  if (candidate < startOfToday) {
    // new Date handles the year rollover when mo + 1 === 12.
    candidate = new Date(y, mo + 1, clampDay(y, mo + 1, dueDay));
  }
  return Math.round((candidate.getTime() - startOfToday.getTime()) / 86400000);
}

/**
 * Guarantees the Cash card exists, and tells the household about it.
 *
 * features/db-migrations.ts seeds this row on every install, so normally this is
 * a single SELECT that finds it. It is called anyway at the moment something is
 * about to be moved onto Cash: moving transactions onto a card that isn't there
 * would recreate the dangling-cardId problem this whole mechanism exists to
 * prevent, and it would do it while the user was being told nothing was lost.
 *
 * Unlike the migration's seed this DOES journal, because it can — sync is live
 * by the time a user deletes a card. That also hands the Cash row to a household
 * member whose build predates the migration, so the reassigned transactions
 * arriving right behind it have somewhere to land.
 *
 * Not a launch-time repair: it only ever runs on the path that needs it, so a
 * Cash row deliberately removed through sync is not resurrected on every start.
 */
export async function ensureCashCard(): Promise<Card> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Card>('SELECT * FROM cards WHERE id = ?', [CASH_CARD_ID]);
  if (existing) return existing;

  const card: Card = {
    id: CASH_CARD_ID,
    name: CASH_CARD_NAME,
    lastFour: '',
    color: CASH_CARD_COLOR,
    sortOrder: CASH_CARD_SORT_ORDER,
    billDay: null,
    dueDay: null,
  };
  await db.runAsync(
    'INSERT OR IGNORE INTO cards (id, name, lastFour, color, sortOrder, billDay, dueDay) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [card.id, card.name, card.lastFour, card.color, card.sortOrder, card.billDay, card.dueDay]
  );
  await queueSyncMutation('CREATE', 'cards', card.id, card);
  return card;
}

export async function deleteCard(id: string): Promise<void> {
  // Cash is not deletable. The guard lives in the write layer, not in the
  // screens, so no present or future caller can destroy the row every
  // transaction falls back to — see CASH_CARD_ID in lib/models.ts for why the id
  // itself is the guard rather than a `protected` column.
  if (id === CASH_CARD_ID) return;

  const db = await getDb();
  // Deleting a card used to delete its transactions too, because cardId is NOT
  // NULL and there was nowhere else to put them. That silently destroyed months
  // of history on a mis-swipe. They move to Cash instead: the spend was real
  // whatever plastic it was on, and the card is the only thing being removed.
  await ensureCashCard();
  const movedTransactions = await db.getAllAsync<{ id: string }>('SELECT id FROM transactions WHERE cardId = ?', [id]);
  // Recurring rules carry a cardId too, and FK cascades never fire here (foreign
  // keys are off), so leaving them behind would post a new transaction onto a
  // card that no longer exists every month, forever.
  const movedRecurring = await db.getAllAsync<{ id: string }>('SELECT id FROM recurring_transactions WHERE cardId = ?', [id]);

  await db.runAsync('UPDATE transactions SET cardId = ? WHERE cardId = ?', [CASH_CARD_ID, id]);
  await db.runAsync('UPDATE recurring_transactions SET cardId = ? WHERE cardId = ?', [CASH_CARD_ID, id]);
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);

  // Every moved row needs its own UPDATE in the outbox. The card's DELETE alone
  // would reach the other member and leave THEIR copy of these transactions
  // pointing at a card neither device still has.
  await journalRowsAsUpdates('transactions', movedTransactions.map((t) => t.id));
  await journalRowsAsUpdates('recurring_transactions', movedRecurring.map((r) => r.id));
  await queueSyncMutation('DELETE', 'cards', id, { id });
}

/**
 * How many transactions deleteCard would move onto Cash.
 *
 * Counted straight from the database rather than from the loaded month, because
 * deleteCard reaches across every month — a figure built from the visible month
 * would understate the change on exactly the cards that matter most.
 */
export async function countTransactionsForCard(cardId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM transactions WHERE cardId = ?', [cardId]);
  return row?.n ?? 0;
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
  await queueSyncMutation('CREATE', 'categories', category.id, category);
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
  await queueSyncMutation('UPDATE', 'categories', id, next);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = await getDb();
  // FK enforcement is off, so the schema's ON DELETE SET NULL never fires and a
  // deleted category would leave transactions with a dangling categoryId — they
  // vanish from every category view yet still count toward surplus. Null them
  // explicitly so they become uncategorized and resurface in the review flow.
  const orphaned = await db.getAllAsync<{ id: string }>('SELECT id FROM transactions WHERE categoryId = ?', [id]);
  await db.runAsync('UPDATE transactions SET categoryId = NULL WHERE categoryId = ?', [id]);
  await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
  await journalRowsAsUpdates('transactions', orphaned.map((o) => o.id));
  await queueSyncMutation('DELETE', 'categories', id, { id });
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
  // A new goal starts unlinked: filing money into a fund is opt-in, never a
  // guess from the goal's name.
  const goal: SavingsGoal = {
    id: uuid(),
    sortOrder,
    targetFundId: null,
    targetAccountId: null,
    targetAmount: null,
    ...input,
  };
  await db.runAsync(
    'INSERT INTO savings_goals (id, name, monthlyAmount, sortOrder, targetFundId, targetAccountId, targetAmount) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [goal.id, goal.name, goal.monthlyAmount, goal.sortOrder, goal.targetFundId ?? null, goal.targetAccountId ?? null, goal.targetAmount ?? null]
  );
  await queueSyncMutation('CREATE', 'savings_goals', goal.id, goal);
  return goal;
}

export async function updateSavingsGoal(id: string, patch: Partial<Omit<SavingsGoal, 'id'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<SavingsGoal>('SELECT * FROM savings_goals WHERE id = ?', [id]);
  if (!existing) return;
  // Coalesce rather than letting undefined through: SQLite can't bind it, and a
  // row read back before the migration ran has no such property at all.
  const targetFundId: string | null =
    (patch.targetFundId !== undefined ? patch.targetFundId : existing.targetFundId) ?? null;
  const targetAccountId: string | null =
    (patch.targetAccountId !== undefined ? patch.targetAccountId : existing.targetAccountId) ?? null;
  // Same coalescing rule as the link columns above.
  const targetAmount: number | null =
    (patch.targetAmount !== undefined ? patch.targetAmount : existing.targetAmount) ?? null;
  const next: SavingsGoal = { ...existing, ...patch, targetFundId, targetAccountId, targetAmount };
  await db.runAsync(
    'UPDATE savings_goals SET name = ?, monthlyAmount = ?, sortOrder = ?, targetFundId = ?, targetAccountId = ?, targetAmount = ? WHERE id = ?',
    [next.name, next.monthlyAmount, next.sortOrder, targetFundId, targetAccountId, targetAmount, id]
  );
  await queueSyncMutation('UPDATE', 'savings_goals', id, next);
  // Re-run after ANY goal edit, not just a link change: the amount also feeds
  // the filed contributions, so editing it would otherwise leave the Funds grid
  // showing the number the goal used to have.
  await reconcileGoalFundEntries(id);
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const db = await getDb();
  // FK enforcement is off, so the schema's ON DELETE CASCADE never fires and
  // every row hanging off this goal has to be swept by hand — otherwise its
  // contributions keep propping up a fund's balance with nothing on screen to
  // explain them, and the co-member's total stays permanently higher than ours.
  // The Funds entries go first, while the goal's link is still readable.
  await reconcileSavingsGoalEntries(id, { fundId: null, accountId: null }, []);
  const transfers = await db.getAllAsync<{ id: string }>('SELECT id FROM savings_goal_transfers WHERE goalId = ?', [id]);
  const budgets = await db.getAllAsync<{ id: string }>('SELECT id FROM savings_goal_budgets WHERE goalId = ?', [id]);
  await db.runAsync('DELETE FROM savings_goal_transfers WHERE goalId = ?', [id]);
  await db.runAsync('DELETE FROM savings_goal_budgets WHERE goalId = ?', [id]);
  await db.runAsync('DELETE FROM savings_goals WHERE id = ?', [id]);
  for (const t of transfers) await queueSyncMutation('DELETE', 'savings_goal_transfers', t.id, { id: t.id });
  for (const b of budgets) await queueSyncMutation('DELETE', 'savings_goal_budgets', b.id, { id: b.id });
  await queueSyncMutation('DELETE', 'savings_goals', id, { id });
}

/**
 * Files this goal's ticked months into the Funds grid — the whole point of the
 * goal ↔ fund link.
 *
 * Rebuilds the goal's contributions from scratch on every call instead of
 * reacting to the one box that changed, so ticking, unticking, correcting an
 * amount, re-linking and unlinking all converge on the same answer and none of
 * them can strand an entry. Cheap: a goal has one transfer row per month it has
 * ever been ticked in.
 *
 * A missing goal, or one with no link, produces an empty target — which is how
 * a deleted or unlinked goal's entries get swept rather than left behind.
 */
export async function reconcileGoalFundEntries(goalId: string): Promise<void> {
  const db = await getDb();
  const goal = await db.getFirstAsync<SavingsGoal>('SELECT * FROM savings_goals WHERE id = ?', [goalId]);
  const ticked = await db.getAllAsync<{ yearMonth: string }>(
    'SELECT yearMonth FROM savings_goal_transfers WHERE goalId = ? AND transferred = 1 ORDER BY yearMonth ASC',
    [goalId]
  );

  const months = [];
  for (const t of ticked) {
    // Per month, because each one carries the amount that month was actually
    // budgeted at — resolveSavingsGoalAmounts carries the last snapshot forward,
    // so a raise in June doesn't rewrite what went into the pot in March.
    const amounts = await resolveSavingsGoalAmounts(t.yearMonth);
    months.push({ yearMonth: t.yearMonth, amount: amounts.get(goalId) ?? goal?.monthlyAmount ?? 0 });
  }

  await reconcileSavingsGoalEntries(
    goalId,
    { fundId: goal?.targetFundId ?? null, accountId: goal?.targetAccountId ?? null },
    months
  );
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
/**
 * Journals an upserted row for sync.
 *
 * The month-scoped tables upsert on a natural key (categoryId+yearMonth, …) with
 * a freshly generated `id`, so the caller doesn't know the surviving row's id —
 * and sync is keyed on it. Re-read the row and journal exactly what landed, so
 * every member converges on the same record instead of the row silently staying
 * on one device.
 */
export async function journalUpsert(table: string, whereSql: string, params: (string | number)[]): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${whereSql}`, params);
  if (row?.id) await queueSyncMutation('UPDATE', table, row.id as string, row);
}

export async function setCategoryLimitForMonth(categoryId: string, yearMonth: string, monthlyLimit: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO category_budgets (id, categoryId, yearMonth, monthlyLimit) VALUES (?, ?, ?, ?)
     ON CONFLICT (categoryId, yearMonth) DO UPDATE SET monthlyLimit = excluded.monthlyLimit`,
    [uuid(), categoryId, yearMonth, monthlyLimit]
  );
  await journalUpsert('category_budgets', 'categoryId = ? AND yearMonth = ?', [categoryId, yearMonth]);
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
  await journalUpsert('savings_goal_budgets', 'goalId = ? AND yearMonth = ?', [goalId, yearMonth]);
  // Correcting the amount of a month already ticked has to move the money that
  // was filed for it, or the Funds grid keeps showing the old figure with no
  // way to tell it apart from a real contribution.
  await reconcileGoalFundEntries(goalId);
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
  await journalUpsert('savings_goal_transfers', 'goalId = ? AND yearMonth = ?', [goalId, yearMonth]);
  // The tick means the money really moved, so a goal linked to a fund files the
  // contribution here rather than making the user type the same number into the
  // Funds grid as well. Unticking removes it again. Lives in the write layer,
  // not the screen, so every caller gets it — and journals — identically.
  await reconcileGoalFundEntries(goalId);
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
  await journalUpsert('monthly_settings', 'yearMonth = ?', [yearMonth]);
}

/**
 * Resolves the salary to use for a given month, per the fixed/variable setting.
 *
 * In a shared household the salary is a property of the BUDGET, not of the
 * phone: "left to spend" and every over-budget figure divide by it, so if each
 * member keeps their own the two devices disagree on the headline numbers even
 * though the transactions match. `app_settings` deliberately never syncs (it
 * also holds device-local things like the biometric lock), so the synced
 * `monthly_settings` row is the shared source of truth whenever it exists.
 */
export async function resolveSalaryForMonth(yearMonth: string): Promise<number> {
  const settings = await getAppSettings();
  const monthly = await getMonthlySettings(yearMonth);
  if (settings.householdId && monthly?.salary != null) return monthly.salary;
  if (settings.salaryMode === 'fixed') return settings.fixedSalary;
  return monthly?.salary ?? 0;
}

// ---------- Transactions ----------

/**
 * Splits are attached HERE rather than left to each caller.
 *
 * Every consumer that sums money per category has to see them, and a caller
 * that forgets does not fail loudly — it just reports a smaller number for a
 * split category and a larger one for the parent, which looks exactly like a
 * real budget. Making the loader responsible costs one extra query per load
 * and removes the whole class of mistake.
 */
export async function listTransactionsForMonth(yearMonth: string): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, createdAt DESC',
    [`${yearMonth}%`]
  );
  return attachSplits(rows);
}

/**
 * One transaction by id, from ANY month.
 *
 * The context only ever holds the selected month, so a screen that looked a
 * transaction up there showed "Transaction not found" for every result Search
 * returned from another month — the row was real, listed, and unopenable.
 */
export async function getTransactionById(id: string): Promise<Transaction | null> {
  const db = await getDb();
  const row = (await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', [id])) ?? null;
  if (!row) return null;
  return { ...row, splits: await listSplitsFor(id) };
}

export async function listUncategorizedTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>('SELECT * FROM transactions WHERE categoryId IS NULL ORDER BY date DESC');
}

/**
 * Every month that has at least one transaction, as "YYYY-MM", oldest first.
 *
 * Feeds the month picker's dots. Without them the picker is a blind grid: a
 * statement that imported into the wrong year leaves rows in a month nobody
 * would think to look at, and a dot is the only thing that says "something is
 * over here".
 */
export async function listMonthsWithTransactions(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ ym: string }>(
    "SELECT DISTINCT substr(date, 1, 7) AS ym FROM transactions ORDER BY ym ASC"
  );
  return rows.map((r) => r.ym);
}

export async function listAllTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Transaction>('SELECT * FROM transactions ORDER BY date DESC, createdAt DESC');
  // Attached for the same reason as listTransactionsForMonth: CSV export and
  // the backup both read through here, and a split dropped on the way out is a
  // split lost on the way back in.
  return attachSplits(rows);
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
  await queueSyncMutation('CREATE', 'transactions', tx.id, tx);
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
  await queueSyncMutation('UPDATE', 'transactions', id, next);
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  // Parts are deleted explicitly, not by ON DELETE CASCADE: foreign keys are
  // not enforced in this database (AGENTS.md), so the cascade never fires.
  // Orphaned parts would keep counting toward category totals forever, with no
  // transaction left to explain where the money came from.
  await deleteSplitsFor(id);
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
  await queueSyncMutation('DELETE', 'transactions', id, { id });
}

// ---------- Transaction splits ----------

/** Attach each transaction's parts in ONE query rather than one per row — a
 * month of imported statement rows is hundreds of transactions, and a query
 * each would make every month change visibly slow. */
export async function attachSplits(transactions: Transaction[]): Promise<Transaction[]> {
  if (transactions.length === 0) return transactions;
  const db = await getDb();
  const placeholders = transactions.map(() => '?').join(',');
  const rows = await db.getAllAsync<TransactionSplit>(
    `SELECT id, transactionId, categoryId, amount FROM transaction_splits WHERE transactionId IN (${placeholders}) ORDER BY id ASC`,
    transactions.map((t) => t.id)
  );
  if (rows.length === 0) return transactions.map((t) => ({ ...t, splits: [] }));
  const byTransaction = new Map<string, TransactionSplit[]>();
  for (const r of rows) {
    const list = byTransaction.get(r.transactionId);
    if (list) list.push(r);
    else byTransaction.set(r.transactionId, [r]);
  }
  return transactions.map((t) => ({ ...t, splits: byTransaction.get(t.id) ?? [] }));
}

export async function listSplitsFor(transactionId: string): Promise<TransactionSplit[]> {
  const db = await getDb();
  return db.getAllAsync<TransactionSplit>(
    'SELECT id, transactionId, categoryId, amount FROM transaction_splits WHERE transactionId = ? ORDER BY id ASC',
    [transactionId]
  );
}

async function deleteSplitsFor(transactionId: string): Promise<void> {
  const db = await getDb();
  const existing = await listSplitsFor(transactionId);
  await db.runAsync('DELETE FROM transaction_splits WHERE transactionId = ?', [transactionId]);
  // Each removal is journalled individually: the sync mirror is keyed per
  // record, so a bulk delete that journalled nothing would leave the other
  // device's copies in place and its category totals permanently wrong.
  for (const s of existing) {
    await queueSyncMutation('DELETE', 'transaction_splits', s.id, { id: s.id });
  }
}

/**
 * Replace a transaction's parts wholesale.
 *
 * Delete-then-insert rather than diffing: ids are derived from the index
 * (splitId()), so editing a three-way split down to two would otherwise leave
 * `split-<tx>-2` behind — a part with no row in the editor that still counts
 * toward a category total. Wholesale replacement makes the stored set exactly
 * what the user saw.
 *
 * Passing an empty array turns a split transaction back into a plain one.
 *
 * NOTE: this does NOT validate. Call validateSplits() from
 * lib/transaction-splits.ts at the call site and refuse to save on errors —
 * storing parts that do not sum to the total moves money out of the books.
 */
export async function setTransactionSplits(transactionId: string, parts: SplitPart[]): Promise<void> {
  const db = await getDb();
  await deleteSplitsFor(transactionId);
  for (const [index, part] of parts.entries()) {
    const row: TransactionSplit = {
      id: splitId(transactionId, index),
      transactionId,
      categoryId: part.categoryId,
      amount: part.amount,
    };
    await db.runAsync(
      'INSERT OR REPLACE INTO transaction_splits (id, transactionId, categoryId, amount) VALUES (?, ?, ?, ?)',
      [row.id, row.transactionId, row.categoryId, row.amount]
    );
    await queueSyncMutation('CREATE', 'transaction_splits', row.id, row);
  }
}

// ---------- Core calculations (spec Section 5) ----------

export function sumAmount(transactions: Transaction[]): number {
  // Round to whole cents so floating-point drift (0.1 + 0.2 …) can't leak into
  // surplus, "remaining", or the budget score — which otherwise flips on a
  // sub-cent and can render "-$0.00".
  const cents = transactions.reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  return cents / 100;
}

/** 5.1 Monthly Surplus = Salary − SUM(transactions) − SUM(transferred savings).
 *
 * Cash model (deliberate, reaffirmed 2026-07-18): only savings you've ticked
 * as actually TRANSFERRED this month reduce "Left to spend" — a planned goal
 * on its own doesn't move the number until the money really moves. */
export async function computeSurplus(yearMonth: string): Promise<{ salary: number; spend: number; savings: number; surplus: number }> {
  const [salary, transactions, goals, transferStatus, goalAmounts] = await Promise.all([
    resolveSalaryForMonth(yearMonth),
    listTransactionsForMonth(yearMonth),
    listSavingsGoals(),
    listTransferStatus(yearMonth),
    resolveSavingsGoalAmounts(yearMonth),
  ]);
  return computeSurplusFrom(salary, transactions, goals, transferStatus, goalAmounts);
}

// ---------- Pure computation over already-loaded data ----------
//
// The month-scoped numbers used to be five independent async functions, and
// every one of them re-read the same rows: a single context refresh ran
// listTransactionsForMonth FOUR times for one month, plus listCategories,
// listSavingsGoals, listTransferStatus and resolveSavingsGoalAmounts twice
// each. On Insights it was worse — the six-month trend called computeSurplus
// per month, so switching month fired roughly fifty SQLite round-trips, each
// one an async bridge hop, before anything could redraw.
//
// The computations themselves are trivial arithmetic. Splitting them out as
// pure functions lets a caller that already holds the rows — the context's
// refresh does — do the work without going back to the database. The async
// wrappers above stay for callers that only want one number.

export function computeSurplusFrom(
  salary: number,
  transactions: Transaction[],
  goals: SavingsGoal[],
  transferStatus: Map<string, boolean>,
  goalAmounts: Map<string, number>
): { salary: number; spend: number; savings: number; surplus: number } {
  const spend = sumAmount(transactions);
  const savings = totalTransferredSavings(goals, transferStatus, goalAmounts);
  return { salary, spend, savings, surplus: salary - spend - savings };
}

/** 5.2 + 5.3 Category spend + budget health, sorted worst-to-best. Each
 * category's limit is resolved as of `yearMonth` (see resolveCategoryLimits)
 * so past months keep the budget they actually had, not today's numbers. */
/**
 * Carry per category for `yearMonth`, for the categories that roll over.
 *
 * Reads the WHOLE transaction history once rather than querying per month.
 * Rollover is a running sum from the category's first month, so a per-month
 * query would be one round trip per month per category — a two-year-old budget
 * with a dozen categories is nearly three hundred queries every time the month
 * changes.
 *
 * Spend is attributed through categoryAmounts(), NOT by grouping
 * transactions.categoryId in SQL. A split transaction keeps its parent
 * categoryId for older builds, so the SQL version counts a split under both its
 * parts and its parent — which is exactly what the previous rollover
 * implementation did.
 */
export async function resolveRollovers(yearMonth: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rolloverCategories = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM categories WHERE rolloverEnabled = 1'
  );
  if (rolloverCategories.length === 0) return new Map();
  const enabled = new Set(rolloverCategories.map((c) => c.id));

  // Every month that has any history at all, earliest first. A category with
  // no transactions and no budget snapshot has nothing to carry.
  const monthRows = await db.getAllAsync<{ ym: string }>(
    `SELECT DISTINCT substr(date, 1, 7) AS ym FROM transactions
     UNION SELECT DISTINCT yearMonth AS ym FROM category_budgets
     ORDER BY ym ASC`
  );
  const months = monthRows.map((r) => r.ym).filter((ym) => ym < yearMonth);
  if (months.length === 0) return new Map();

  const [categories, allTransactions] = await Promise.all([listCategories(), listAllTransactions()]);

  // month -> categoryId -> spend
  const spendByMonth = new Map<string, Map<string, number>>();
  for (const t of allTransactions) {
    const ym = t.date.slice(0, 7);
    if (ym >= yearMonth) continue;
    let bucket = spendByMonth.get(ym);
    if (!bucket) {
      bucket = new Map();
      spendByMonth.set(ym, bucket);
    }
    for (const [categoryId, amount] of categoryAmounts(t)) {
      if (!categoryId || !enabled.has(categoryId)) continue;
      bucket.set(categoryId, (bucket.get(categoryId) ?? 0) + amount);
    }
  }

  // Assigned per month uses the same carry-forward rule as resolveCategoryLimits:
  // a snapshot applies from its month until a newer one replaces it.
  const snapshots = await db.getAllAsync<{ categoryId: string; yearMonth: string; monthlyLimit: number }>(
    'SELECT categoryId, yearMonth, monthlyLimit FROM category_budgets WHERE yearMonth < ? ORDER BY yearMonth ASC',
    [yearMonth]
  );
  const baseLimit = new Map(categories.map((c) => [c.id, c.monthlyLimit]));
  const inputs: RolloverInput[] = [];
  for (const category of categories) {
    if (!enabled.has(category.id)) continue;
    const running = new Map<string, number>();
    let current = baseLimit.get(category.id) ?? 0;
    const history: MonthLedger[] = [];
    for (const ym of months) {
      for (const snap of snapshots) {
        if (snap.categoryId === category.id && snap.yearMonth === ym) current = snap.monthlyLimit;
      }
      running.set(ym, current);
      history.push({ yearMonth: ym, assigned: current, spent: spendByMonth.get(ym)?.get(category.id) ?? 0 });
    }
    inputs.push({ categoryId: category.id, rolloverEnabled: true, history });
  }

  return rolloversInto(inputs, yearMonth);
}

export async function computeCategorySummaries(yearMonth: string): Promise<CategorySpendSummary[]> {
  const [categories, transactions, limitOverrides, rollovers] = await Promise.all([
    listCategories(),
    listTransactionsForMonth(yearMonth),
    resolveCategoryLimits(yearMonth),
    resolveRollovers(yearMonth),
  ]);
  return computeCategorySummariesFrom(categories, transactions, limitOverrides, rollovers);
}

export function computeCategorySummariesFrom(
  categories: Category[],
  transactions: Transaction[],
  limitOverrides: Map<string, number>,
  /** Carry per category, from resolveRollovers. Absent = no rollover anywhere,
   * which is the correct reading for every caller that predates the feature. */
  rollovers?: Map<string, number>
): CategorySpendSummary[] {
  // Attribution goes through categoryAmounts(), never t.categoryId directly:
  // a split transaction keeps its own categoryId populated for older builds,
  // so reading the column here would count its money once under each part AND
  // again under the parent category.
  const spendByCategory = new Map<string, number>();
  for (const t of transactions) {
    for (const [categoryId, amount] of categoryAmounts(t)) {
      if (!categoryId) continue; // uncategorised money is not any category's spend
      spendByCategory.set(categoryId, (spendByCategory.get(categoryId) ?? 0) + amount);
    }
  }
  const summaries: CategorySpendSummary[] = categories.map((category) => {
    const monthlyLimit = limitOverrides.get(category.id) ?? category.monthlyLimit;
    const spend = spendByCategory.get(category.id) ?? 0;
    // Missing from the map means rollover is OFF for this category, which is a
    // different statement from a zero balance — see CategorySpendSummary.
    const carriedOver = rollovers?.has(category.id) ? rollovers.get(category.id)! : null;
    // Rounded in cents: available feeds `remaining`, which is the headline
    // number on every category row, and a float sum renders "-$0.00".
    const available = (Math.round(monthlyLimit * 100) + Math.round((carriedOver ?? 0) * 100)) / 100;
    const remaining = available - spend;
    // Status and percent measure spend against what is actually SPENDABLE, not
    // against the assignment. A category sitting on three months of carry is
    // not 'red' the moment it passes this month's limit — it still has money.
    const percent = available > 0 ? (spend / available) * 100 : 0;
    let status: BudgetStatus = 'green';
    if (percent > 100) status = 'red';
    else if (percent >= 80) status = 'amber';
    return { category: { ...category, monthlyLimit }, spend, remaining, status, percent, carriedOver, available };
  });
  return summaries.sort((a, b) => b.percent - a.percent);
}

/** 5.4 Card totals for the month. */
export async function computeCardTotals(yearMonth: string): Promise<Map<string, number>> {
  return computeCardTotalsFrom(await listTransactionsForMonth(yearMonth));
}

export function computeCardTotalsFrom(transactions: Transaction[]): Map<string, number> {
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

/** 5.5 Trend series for the last N months (oldest first).
 *
 * One read of the whole range and one read of the goals, not one computeSurplus
 * per month. The loop version issued five queries per point — thirty for the
 * six-month chart — every time the month changed on Insights, on top of the
 * context's own refresh, all of it before the screen could redraw. */
export async function computeTrendSeries(endYearMonth: string, months = 6): Promise<TrendPoint[]> {
  const startYearMonth = shiftYearMonth(endYearMonth, -(months - 1));
  const [goals, rangeTransactions] = await Promise.all([
    listSavingsGoals(),
    listTransactionsBetweenMonths(startYearMonth, endYearMonth),
  ]);

  const byMonth = new Map<string, Transaction[]>();
  for (const t of rangeTransactions) {
    const ym = t.date.slice(0, 7);
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(t);
    else byMonth.set(ym, [t]);
  }

  const yearMonths: string[] = [];
  for (let i = months - 1; i >= 0; i--) yearMonths.push(shiftYearMonth(endYearMonth, -i));

  // The remaining per-month reads (salary, which goals were ticked, and their
  // amounts that month) genuinely differ per month, but they can all go out at
  // once instead of six sequential round trips.
  const perMonth = await Promise.all(
    yearMonths.map(async (ym) => {
      const [salary, transfers, goalAmounts] = await Promise.all([
        resolveSalaryForMonth(ym),
        listTransferStatus(ym),
        resolveSavingsGoalAmounts(ym),
      ]);
      return { ym, salary, transfers, goalAmounts };
    })
  );

  return perMonth.map(({ ym, salary, transfers, goalAmounts }) => {
    const { spend, surplus } = computeSurplusFrom(salary, byMonth.get(ym) ?? [], goals, transfers, goalAmounts);
    return { yearMonth: ym, totalSpend: spend, surplus };
  });
}

/** Every transaction from the first day of `startYearMonth` to the last of
 * `endYearMonth`, inclusive. String comparison works because dates are stored
 * as YYYY-MM-DD. */
export async function listTransactionsBetweenMonths(startYearMonth: string, endYearMonth: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    'SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC, createdAt DESC',
    [`${startYearMonth}-01`, `${endYearMonth}-31`]
  );
}

/** 5.6 Month-over-month category movers. Compares each category's spend in
 * `yearMonth` against the prior month and returns them sorted by the size of
 * the change (largest swing first). Categories with no spend in either month
 * are dropped. Reuses the same per-month transaction queries as the rest of
 * the app so it stays consistent with what "spend" means elsewhere. */
export async function computeCategoryMovers(yearMonth: string): Promise<CategoryMover[]> {
  const prevYearMonth = shiftYearMonth(yearMonth, -1);
  const [categories, currentTx, prevTx] = await Promise.all([
    listCategories(),
    listTransactionsForMonth(yearMonth),
    listTransactionsForMonth(prevYearMonth),
  ]);
  const sumByCategory = (txs: Transaction[]) => {
    const map = new Map<string, number>();
    for (const t of txs) {
      if (!t.categoryId) continue;
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
    }
    return map;
  };
  const currentByCat = sumByCategory(currentTx);
  const prevByCat = sumByCategory(prevTx);

  const movers: CategoryMover[] = [];
  for (const category of categories) {
    const current = currentByCat.get(category.id) ?? 0;
    const previous = prevByCat.get(category.id) ?? 0;
    if (current === 0 && previous === 0) continue;
    const delta = current - previous;
    const percentChange = previous > 0 ? (delta / previous) * 100 : null;
    movers.push({ category, current, previous, delta, percentChange });
  }
  return movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
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

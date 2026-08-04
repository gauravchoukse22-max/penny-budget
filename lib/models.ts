export type Card = {
  id: string;
  name: string;
  lastFour: string;
  color: string;
  sortOrder: number;
  /** Day of month (1-31) the statement closes. Null if not tracked. */
  billDay: number | null;
  /** Day of month (1-31) payment is due. Null if not tracked. */
  dueDay: number | null;
};

/**
 * The seeded "Cash" card — the home for spending that belongs to no real card:
 * cash, a card you never added, and the transactions rescued when a card is
 * deleted (see deleteCard, which moves them here rather than destroying them).
 *
 * The id is a FIXED, well-known string rather than a uuid() on purpose. Every
 * device seeds this row independently, and a random id would make it a different
 * row per phone — which is exactly how this household ended up with duplicate
 * cards and categories after a sync. Same precedent as `rec-<ruleId>-<postDate>`
 * in features/recurring-transactions.ts: an id two devices derive rather than
 * invent collapses into one record under the last-writer-wins upsert.
 *
 * That fixed id is ALSO the deletion guard (lib/queries.ts deleteCard). A
 * `protected` flag column would not survive: the sync pull applies remote rows
 * with `INSERT OR REPLACE INTO cards (<columns in the payload>)`, so a co-member
 * on a build without the column pushes a payload without it and the whole row is
 * replaced with the flag back at its default — the protection would silently
 * evaporate on the next sync. A primary key can never be rewritten that way.
 */
export const CASH_CARD_ID = 'penny-cash-card';
export const CASH_CARD_NAME = 'Cash';
/** CATEGORY_PALETTE's green. Duplicated as a literal rather than imported so
 * this module stays dependency-free — features/db-migrations.ts seeds the row
 * and deliberately imports nothing that could pull it into a cycle. */
export const CASH_CARD_COLOR = '#34C759';
/**
 * Deliberately far above any real card's sortOrder so Cash always sorts LAST.
 * Cards are listed by sortOrder, and several screens default to `cards[0]` —
 * sorting Cash first would silently make it the default card for new
 * transactions and recurring bills. createCard's MAX(sortOrder) + 1 skips this
 * row so a new real card doesn't inherit the gap.
 */
export const CASH_CARD_SORT_ORDER = 1_000_000;

/** True for the seeded Cash row, which cannot be deleted or swiped away. */
export function isCashCard(cardId: string): boolean {
  return cardId === CASH_CARD_ID;
}

export type Category = {
  id: string;
  name: string;
  icon: string; // SF Symbol name (rendered via expo-symbols on iOS)
  color: string;
  monthlyLimit: number;
  sortOrder: number;
};

export type TransactionSource = 'manual' | 'imported' | 'recurring';

export type TransactionSplit = {
  id: string;
  transactionId: string;
  categoryId: string | null;
  amount: number;
};

export type Transaction = {
  id: string;
  amount: number;
  date: string; // ISO date, "2026-07-08"
  categoryId: string | null;
  cardId: string;
  note: string | null;
  source: TransactionSource;
  createdAt: string;
  /**
   * Parts this transaction is split into, when it has any.
   *
   * Optional because it is only populated by the loaders that ask for it —
   * a Transaction read straight off the table has no splits attached, and
   * `undefined` there means "not loaded", not "no splits". Anything summing
   * money per category must go through categoryAmounts() in
   * lib/transaction-splits.ts rather than reading categoryId directly, or a
   * split transaction gets counted under both its parts AND its own category.
   */
  splits?: TransactionSplit[];
};

export type SavingsGoal = {
  id: string;
  name: string;
  monthlyAmount: number;
  sortOrder: number;
  /**
   * Optional link to one cell of the Funds grid: ticking this goal's monthly
   * transfer files a contribution there automatically.
   *
   * Both halves must be set for the link to count — a fund entry needs a fund
   * (which pot) AND an account (which institution). Optional rather than
   * `string | null` so callers that only ever create a plain goal (onboarding,
   * the Budget screen's add row) still typecheck; rows read back from SQLite
   * always carry both, as null when unlinked.
   */
  targetFundId?: string | null;
  targetAccountId?: string | null;
  /**
   * What the goal is FOR — "$3,000 emergency fund". Null is a real answer, not
   * missing data: an open-ended "just keep saving" goal has no target, and the
   * planner says "no target set" rather than inventing one.
   */
  targetAmount?: number | null;
};

/** Whether a savings goal's monthly transfer was marked done for a given month. */
export type SavingsGoalTransfer = {
  goalId: string;
  yearMonth: string;
  transferred: boolean;
};

export type MonthlySettings = {
  id: string;
  yearMonth: string; // "2026-07"
  salary: number;
};

export type SalaryMode = 'fixed' | 'variable';

export type AppSettings = {
  currency: string;
  salaryMode: SalaryMode;
  fixedSalary: number;
  onboarded: boolean;
  /** Require Face ID / Touch ID to open the app. */
  biometricLock: boolean;
  /** Minutes the app can be backgrounded before it re-locks (0 = immediately). */
  autoLockGraceMinutes: number;
  /** Blur/mask money figures until revealed (shoulder-surfing defense). */
  hideAmounts: boolean;
  /** Whether optional iCloud (CloudKit) sync is enabled. */
  cloudSyncEnabled: boolean;
  /** The household this device co-edits, or null if sharing is off. */
  householdId: string | null;
  /** JSON: Insights card order + visibility (see lib/insights-layout.ts).
   * Null until the user first customizes — the default layout applies.
   * Device-local: app_settings deliberately never syncs. */
  insightsLayout: string | null;
  /** JSON: category ids the Insights Watchlist card tracks (max 3).
   * Device-local for the same reason. */
  watchedCategories: string | null;
};

export type BudgetStatus = 'green' | 'amber' | 'red';

export type CategorySpendSummary = {
  category: Category;
  spend: number;
  remaining: number;
  status: BudgetStatus;
  percent: number; // 0-100+
};

export type TrendPoint = {
  yearMonth: string;
  totalSpend: number;
  surplus: number;
};

/** A category's spend this month vs. the previous month — the "biggest movers"
 * insight ("Dining +23% vs last month"). */
export type CategoryMover = {
  category: Category;
  current: number;
  previous: number;
  /** current − previous (positive = spending went up). */
  delta: number;
  /** Percent change vs. last month, or null when there was no prior spend. */
  percentChange: number | null;
};

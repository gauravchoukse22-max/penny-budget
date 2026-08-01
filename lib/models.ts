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

export type Category = {
  id: string;
  name: string;
  icon: string; // SF Symbol name (rendered via expo-symbols on iOS)
  color: string;
  monthlyLimit: number;
  sortOrder: number;
};

export type TransactionSource = 'manual' | 'imported' | 'recurring';

export type Transaction = {
  id: string;
  amount: number;
  date: string; // ISO date, "2026-07-08"
  categoryId: string | null;
  cardId: string;
  note: string | null;
  source: TransactionSource;
  createdAt: string;
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

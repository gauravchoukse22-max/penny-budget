// ---------------------------------------------------------------------------
// features/models.ts – Extended type definitions for Penny Budget's
// intelligence engine.  These complement the core types in ../lib/models.
// ---------------------------------------------------------------------------

/** A bill or subscription that recurs each month. */
export type RecurringTransaction = {
  id: string;
  note: string;
  amount: number;
  categoryId: string | null;
  cardId: string;
  /** Day of the month (1-31) the charge typically posts. */
  dayOfMonth: number;
  /** The next expected posting date (YYYY-MM-DD). */
  nextPostDate: string;
  /** Whether this recurring item is currently active. */
  active: boolean;
};

/** User-defined keyword → category mapping for smart categorization. */
export type CategoryRule = {
  id: string;
  /** Case-insensitive keyword matched against transaction notes. */
  keyword: string;
  categoryId: string;
};

// ── Funds grid ──────────────────────────────────────────────────────────────
// Models a savings spreadsheet: funds are the rows, fund accounts are the
// columns, and a cell is everything ever paid into that fund at that account.
// A cell's balance and every total are derived by summing entries, never
// stored, so a rename, a reorder or a half-applied sync can't leave a stale
// number behind — and last April's contribution is still there to look up.

/** A savings bucket the user keeps adding to — a row in the Funds grid. */
export type Fund = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

/** An institution funds are held at — a column in the Funds grid. */
export type FundAccount = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

/**
 * One contribution to one cell — the spreadsheet comment, made into a record.
 *
 * `amount` is signed: money in is positive, money out negative. A cell's
 * balance is the SUM of its entries, so nothing is ever overwritten and
 * "how much did we add in April?" stays answerable months later.
 */
export type FundEntry = {
  id: string;
  fundId: string;
  accountId: string;
  amount: number;
  /** YYYY-MM-DD — the day the money moved, which the user can backdate. */
  date: string;
  note: string | null;
  createdAt: string;
};

/**
 * LEGACY: the single running balance a cell used to hold. Read only by the
 * one-time backfill that turns each one into an opening entry, and kept so a
 * co-member still on the old build doesn't break this device's sync.
 */
export type FundBalance = {
  id: string;
  fundId: string;
  accountId: string;
  amount: number;
  updatedAt: string;
  /** Set once this row has become an opening entry. Never synced. */
  migratedAt?: string | null;
};

/** How a cell edit combines with what's already there. */
export type FundAdjustMode = 'add' | 'subtract' | 'set';

/** One month of a fund's history, as the per-fund history screen shows it. */
export type FundMonthSummary = {
  /** YYYY-MM. */
  yearMonth: string;
  /** Money in this month (positive entries only). */
  added: number;
  /** Money out this month, as a positive number. */
  removed: number;
  /** added − removed. */
  net: number;
  /** What the fund held once this month's entries had all landed. */
  balanceAfter: number;
  /** Newest first, so the list reads the way the month header does. */
  entries: FundEntry[];
};

/** Tracks user engagement streaks (e.g. logging every day). */
export type Streak = {
  id: string;
  type: 'logging' | 'under_budget';
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
};

/** An event rendered on the monthly calendar view. */
export type CalendarEvent = {
  /** Day of the month (1-31). */
  day: number;
  label: string;
  amount: number;
  type: 'bill' | 'due_date' | 'payday';
  color: string;
};

/** High-level summary for a completed month. */
export type MonthlySummary = {
  yearMonth: string;
  totalSpent: number;
  /** Top categories ranked by total spend. */
  topCategories: Array<{ categoryId: string; name: string; total: number }>;
  /** The single largest transaction of the month. */
  biggestPurchase: { note: string | null; amount: number } | null;
  transactionCount: number;
  /** 0-100 score reflecting how many categories stayed within budget. */
  budgetScore: number;
};

/** Forward-looking projection for a single category's spending. */
export type CategoryProjection = {
  categoryId: string;
  /** EMA-weighted historical average monthly spend. */
  historicalAverage: number;
  /** Amount already spent in the current month. */
  currentSpend: number;
  /** Estimated total by month end. */
  projectedFinalSpend: number;
  budgetLimit: number;
  status: 'on_track' | 'warning' | 'over_budget';
};

/** An anomalous transaction flagged by the detection engine. */
export type AnomalyAlert = {
  transactionId: string;
  note: string | null;
  amount: number;
  categoryId: string | null;
  /** Historical average for this category. */
  averageForCategory: number;
  stdDeviation: number;
  severity: 'info' | 'warning' | 'critical';
  explanation: string;
};

/** A suggestion returned by the smart categorization engine. */
export type SmartSuggestion = {
  categoryId: string;
  /** 0-1 confidence score. */
  confidence: number;
  source: 'rule' | 'history' | 'naive_bayes';
  explanation: string;
};

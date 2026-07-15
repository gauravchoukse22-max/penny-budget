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

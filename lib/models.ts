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

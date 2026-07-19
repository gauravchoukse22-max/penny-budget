import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import {
  seedDefaultCategoriesIfEmpty,
  seedDefaultSavingsGoalsIfEmpty,
  addPostLaunchCategoriesIfMissing,
  currentYearMonth,
} from '../lib/db';
import * as q from '../lib/queries';
import { processRecurringTransactions } from '../features/recurring-transactions';
import { updateLoggingStreak } from '../features/streaks-and-gamification';
import { setSyncEnabled, getCloudKitAdapter, runCloudKitSyncCycle } from '../features/cloudkit-sync';
import {
  activateHousehold,
  deactivateHousehold,
  getActiveHouseholdId,
  createHousehold as createHouseholdRpc,
  joinHousehold as joinHouseholdRpc,
  leaveHousehold as leaveHouseholdRpc,
  seedHouseholdFromLocal,
} from '../features/household';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type {
  AppSettings,
  Card,
  Category,
  CategorySpendSummary,
  SavingsGoal,
  Transaction,
} from '../lib/models';

type BudgetContextValue = {
  ready: boolean;
  selectedMonth: string;
  setSelectedMonth: (ym: string) => void;
  goToPrevMonth: () => void;
  goToNextMonth: () => void;

  settings: AppSettings;
  cards: Card[];
  categories: Category[];
  savingsGoals: SavingsGoal[];
  transactions: Transaction[];
  uncategorizedCount: number;

  surplus: { salary: number; spend: number; savings: number; transferred: number; surplus: number };
  categorySummaries: CategorySpendSummary[];
  cardTotals: Map<string, number>;
  transferStatus: Map<string, boolean>;
  savingsGoalAmounts: Map<string, number>;

  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  addCard: (input: Omit<Card, 'id' | 'sortOrder' | 'billDay' | 'dueDay'> & Partial<Pick<Card, 'billDay' | 'dueDay'>>) => Promise<void>;
  editCard: (id: string, patch: Partial<Omit<Card, 'id'>>) => Promise<void>;
  removeCard: (id: string) => Promise<void>;

  addCategory: (input: Omit<Category, 'id' | 'sortOrder'>) => Promise<void>;
  editCategory: (id: string, patch: Partial<Omit<Category, 'id'>>) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;

  addSavingsGoal: (input: Omit<SavingsGoal, 'id' | 'sortOrder'>) => Promise<void>;
  editSavingsGoal: (id: string, patch: Partial<Omit<SavingsGoal, 'id'>>) => Promise<void>;
  removeSavingsGoal: (id: string) => Promise<void>;
  setGoalTransferred: (goalId: string, transferred: boolean) => Promise<void>;
  setCategoryLimitForSelectedMonth: (categoryId: string, limit: number) => Promise<void>;
  setSavingsGoalAmountForSelectedMonth: (goalId: string, amount: number) => Promise<void>;

  addTransaction: (input: Omit<Transaction, 'id' | 'createdAt' | 'source'> & { source?: Transaction['source'] }) => Promise<void>;
  editTransaction: (id: string, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
  categorizeTransaction: (id: string, categoryId: string) => Promise<void>;
  categorizeAllFromNote: (note: string, categoryId: string) => Promise<void>;

  setSalaryForSelectedMonth: (amount: number) => Promise<void>;

  // Family sharing
  syncNow: () => Promise<void>;
  createHousehold: (name?: string) => Promise<{ success: boolean; message: string }>;
  joinHousehold: (code: string) => Promise<{ success: boolean; message: string }>;
  leaveHousehold: () => Promise<{ success: boolean; message: string }>;
};

const BudgetContext = createContext<BudgetContextValue | null>(null);

const emptySurplus = { salary: 0, spend: 0, savings: 0, transferred: 0, surplus: 0 };

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());

  const [settings, setSettings] = useState<AppSettings>({
    currency: 'USD',
    salaryMode: 'fixed',
    fixedSalary: 0,
    onboarded: false,
    biometricLock: false,
    autoLockGraceMinutes: 1,
    hideAmounts: false,
    cloudSyncEnabled: false,
    householdId: null,
  });
  const [cards, setCards] = useState<Card[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [surplus, setSurplus] = useState(emptySurplus);
  const [categorySummaries, setCategorySummaries] = useState<CategorySpendSummary[]>([]);
  const [cardTotals, setCardTotals] = useState<Map<string, number>>(new Map());
  const [transferStatus, setTransferStatus] = useState<Map<string, boolean>>(new Map());
  const [savingsGoalAmounts, setSavingsGoalAmounts] = useState<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    const [s, c, cat, goals, tx, surplusData, catSummaries, totals, transfers, goalAmounts] = await Promise.all([
      q.getAppSettings(),
      q.listCards(),
      q.listCategories(),
      q.listSavingsGoals(),
      q.listTransactionsForMonth(selectedMonth),
      q.computeSurplus(selectedMonth),
      q.computeCategorySummaries(selectedMonth),
      q.computeCardTotals(selectedMonth),
      q.listTransferStatus(selectedMonth),
      q.resolveSavingsGoalAmounts(selectedMonth),
    ]);
    setSettings(s);
    setCards(c);
    setCategories(cat);
    setSavingsGoals(goals);
    setTransactions(tx);
    setSurplus(surplusData);
    setCategorySummaries(catSummaries);
    setCardTotals(totals);
    setTransferStatus(transfers);
    setSavingsGoalAmounts(goalAmounts);
  }, [selectedMonth]);

  useEffect(() => {
    (async () => {
      await seedDefaultCategoriesIfEmpty();
      await addPostLaunchCategoriesIfMissing();
      await seedDefaultSavingsGoalsIfEmpty();
      const initialSettings = await q.getAppSettings();
      // Family sharing: if this device co-edits a household AND the user is
      // signed in, register the Supabase adapter and enable outbox journaling.
      // Otherwise stay local-only (mock adapter, no journaling).
      let householdActive = false;
      if (initialSettings.householdId && isSupabaseConfigured) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          activateHousehold(initialSettings.householdId);
          householdActive = true;
        }
      }
      if (!householdActive) setSyncEnabled(false);
      // Auto-post any recurring bills that have come due since the last launch.
      await processRecurringTransactions();
      await refresh();
      setReady(true);
      // Pull the shared budget on launch when sharing is active.
      if (householdActive && getCloudKitAdapter().isAvailable) {
        runCloudKitSyncCycle().then(() => refresh());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, ready]);

  const goToPrevMonth = useCallback(() => setSelectedMonth((m) => q.addMonths(m, -1)), []);
  const goToNextMonth = useCallback(() => setSelectedMonth((m) => q.addMonths(m, 1)), []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      await q.updateAppSettings(patch);
      if (patch.cloudSyncEnabled !== undefined) setSyncEnabled(patch.cloudSyncEnabled);
      await refresh();
    },
    [refresh]
  );

  // ── Family sharing ────────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    if (getActiveHouseholdId() && getCloudKitAdapter().isAvailable) {
      await runCloudKitSyncCycle();
      await refresh();
    }
  }, [refresh]);

  // Create a household seeded from this device's current budget, then co-edit it.
  const createAndJoinHousehold = useCallback(
    async (name?: string): Promise<{ success: boolean; message: string }> => {
      const res = await createHouseholdRpc(name);
      if (!res.success || !res.data) return res;
      await seedHouseholdFromLocal(res.data);
      activateHousehold(res.data);
      await updateSettings({ householdId: res.data });
      await runCloudKitSyncCycle();
      await refresh();
      return { success: true, message: res.message };
    },
    [refresh, updateSettings]
  );

  // Join an existing household by invite code and pull its shared budget.
  const joinExistingHousehold = useCallback(
    async (code: string): Promise<{ success: boolean; message: string }> => {
      const res = await joinHouseholdRpc(code);
      if (!res.success || !res.data) return res;
      activateHousehold(res.data);
      await updateSettings({ householdId: res.data });
      await runCloudKitSyncCycle();
      await refresh();
      return { success: true, message: res.message };
    },
    [refresh, updateSettings]
  );

  const leaveCurrentHousehold = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    const hid = getActiveHouseholdId() ?? settings.householdId;
    if (hid) await leaveHouseholdRpc(hid);
    deactivateHousehold();
    await updateSettings({ householdId: null });
    await refresh();
    return { success: true, message: 'Left the shared household. Your budget stays on this device.' };
  }, [refresh, updateSettings, settings.householdId]);

  // Pull shared changes when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow();
    });
    return () => sub.remove();
  }, [syncNow]);

  const addCard = useCallback(
    async (input: Omit<Card, 'id' | 'sortOrder' | 'billDay' | 'dueDay'> & Partial<Pick<Card, 'billDay' | 'dueDay'>>) => {
      await q.createCard(input);
      await refresh();
    },
    [refresh]
  );
  const editCard = useCallback(
    async (id: string, patch: Partial<Omit<Card, 'id'>>) => {
      await q.updateCard(id, patch);
      await refresh();
    },
    [refresh]
  );
  const removeCard = useCallback(
    async (id: string) => {
      await q.deleteCard(id);
      await refresh();
    },
    [refresh]
  );

  const addCategory = useCallback(
    async (input: Omit<Category, 'id' | 'sortOrder'>) => {
      await q.createCategory(input);
      await refresh();
    },
    [refresh]
  );
  const editCategory = useCallback(
    async (id: string, patch: Partial<Omit<Category, 'id'>>) => {
      await q.updateCategory(id, patch);
      await refresh();
    },
    [refresh]
  );
  const removeCategory = useCallback(
    async (id: string) => {
      await q.deleteCategory(id);
      await refresh();
    },
    [refresh]
  );

  const addSavingsGoal = useCallback(
    async (input: Omit<SavingsGoal, 'id' | 'sortOrder'>) => {
      await q.createSavingsGoal(input);
      await refresh();
    },
    [refresh]
  );
  const editSavingsGoal = useCallback(
    async (id: string, patch: Partial<Omit<SavingsGoal, 'id'>>) => {
      await q.updateSavingsGoal(id, patch);
      await refresh();
    },
    [refresh]
  );
  const removeSavingsGoal = useCallback(
    async (id: string) => {
      await q.deleteSavingsGoal(id);
      await refresh();
    },
    [refresh]
  );
  const setGoalTransferred = useCallback(
    async (goalId: string, transferred: boolean) => {
      await q.setTransferStatus(goalId, selectedMonth, transferred);
      await refresh();
    },
    [selectedMonth, refresh]
  );
  const setCategoryLimitForSelectedMonth = useCallback(
    async (categoryId: string, limit: number) => {
      await q.setCategoryLimitForMonth(categoryId, selectedMonth, limit);
      await refresh();
    },
    [selectedMonth, refresh]
  );
  const setSavingsGoalAmountForSelectedMonth = useCallback(
    async (goalId: string, amount: number) => {
      await q.setSavingsGoalAmountForMonth(goalId, selectedMonth, amount);
      await refresh();
    },
    [selectedMonth, refresh]
  );

  const addTransaction = useCallback(
    async (input: Omit<Transaction, 'id' | 'createdAt' | 'source'> & { source?: Transaction['source'] }) => {
      await q.createTransaction(input);
      await updateLoggingStreak();
      await refresh();
    },
    [refresh]
  );
  const editTransaction = useCallback(
    async (id: string, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => {
      await q.updateTransaction(id, patch);
      await refresh();
    },
    [refresh]
  );
  const removeTransaction = useCallback(
    async (id: string) => {
      await q.deleteTransaction(id);
      await refresh();
    },
    [refresh]
  );
  const categorizeTransaction = useCallback(
    async (id: string, categoryId: string) => {
      await q.updateTransaction(id, { categoryId });
      await refresh();
    },
    [refresh]
  );
  const categorizeAllFromNote = useCallback(
    async (note: string, categoryId: string) => {
      const all = await q.listUncategorizedTransactions();
      const matches = all.filter((t) => (t.note ?? '').trim().toLowerCase() === note.trim().toLowerCase());
      await Promise.all(matches.map((t) => q.updateTransaction(t.id, { categoryId })));
      await refresh();
    },
    [refresh]
  );

  const setSalaryForSelectedMonth = useCallback(
    async (amount: number) => {
      await q.setMonthlySalary(selectedMonth, amount);
      await refresh();
    },
    [selectedMonth, refresh]
  );

  const uncategorizedCount = useMemo(() => transactions.filter((t) => !t.categoryId).length, [transactions]);

  const value: BudgetContextValue = {
    ready,
    selectedMonth,
    setSelectedMonth,
    goToPrevMonth,
    goToNextMonth,
    settings,
    cards,
    categories,
    savingsGoals,
    transactions,
    uncategorizedCount,
    surplus,
    categorySummaries,
    cardTotals,
    transferStatus,
    savingsGoalAmounts,
    refresh,
    updateSettings,
    addCard,
    editCard,
    removeCard,
    addCategory,
    editCategory,
    removeCategory,
    addSavingsGoal,
    editSavingsGoal,
    removeSavingsGoal,
    setGoalTransferred,
    setCategoryLimitForSelectedMonth,
    setSavingsGoalAmountForSelectedMonth,
    addTransaction,
    editTransaction,
    removeTransaction,
    categorizeTransaction,
    categorizeAllFromNote,
    setSalaryForSelectedMonth,
    syncNow,
    createHousehold: createAndJoinHousehold,
    joinHousehold: joinExistingHousehold,
    leaveHousehold: leaveCurrentHousehold,
  };

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget(): BudgetContextValue {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget must be used within BudgetProvider');
  return ctx;
}

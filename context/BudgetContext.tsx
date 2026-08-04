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
import {
  setSyncEnabled,
  getCloudKitAdapter,
  runCloudKitSyncCycle,
  pullChangesFromCloudKit,
  resetSyncTokenForHousehold,
} from '../features/cloudkit-sync';
import {
  activateHousehold,
  deactivateHousehold,
  getActiveHouseholdId,
  createHousehold as createHouseholdRpc,
  joinHousehold as joinHouseholdRpc,
  leaveHousehold as leaveHouseholdRpc,
  clearLocalBudgetData,
  seedHouseholdFromLocal,
  myHouseholdsResult,
} from '../features/household';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { subscribeToHousehold } from '../features/household-live';
import { useAuth } from './AuthContext';
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

  surplus: { salary: number; spend: number; savings: number; surplus: number };
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

  // Sharing. "Just my devices" and "share with someone" are the same mechanism —
  // one household — so every entry point funnels through these, and each one
  // refuses transitions that would silently put this device on a second budget.
  syncNow: () => Promise<void>;
  createHousehold: (name?: string, opts?: { evenIfAlreadyAMember?: boolean }) => Promise<SharingResult>;
  joinHousehold: (code: string, mode?: JoinMode) => Promise<SharingResult>;
  connectToHousehold: (householdId: string) => Promise<SharingResult>;
  startDeviceSync: () => Promise<SharingResult>;
  pauseSharing: () => Promise<SharingResult>;
  leaveHousehold: () => Promise<SharingResult>;
};

export type SharingResult = { success: boolean; message: string };

/**
 * What joining does with the budget already on this device.
 *
 * 'merge' keeps it — the historic behaviour, and a trap worth naming: joining
 * only ever PULLED, so the joiner's own rows were never pushed up. They stayed
 * private to that one device while looking, side by side with the shared rows,
 * exactly like duplicates that only one phone could see.
 *
 * 'replace' throws it away and takes the shared budget as-is.
 */
export type JoinMode = 'merge' | 'replace';

const BudgetContext = createContext<BudgetContextValue | null>(null);

// Refusing to act beats acting on a guess: an unreachable server and "you are in
// no households" look identical, and acting on the guess is what created the
// duplicate households in the first place.
const COULD_NOT_CHECK =
  "Couldn't check which shared budgets this account belongs to, so nothing changed. Check your connection and try again.";

const emptySurplus = { salary: 0, spend: 0, savings: 0, surplus: 0 };

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
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
    insightsLayout: null,
    watchedCategories: null,
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

  // Read each row set ONCE, then compute. This used to call computeSurplus,
  // computeCategorySummaries and computeCardTotals alongside the raw lists, and
  // every one of those re-queried the same month — four reads of
  // listTransactionsForMonth per refresh, and duplicate reads of categories,
  // goals, transfers and goal amounts. All of it ran on every month change,
  // ahead of any redraw.
  const refresh = useCallback(async () => {
    const [s, c, cat, goals, tx, transfers, goalAmounts, salary, limitOverrides, rollovers] = await Promise.all([
      q.getAppSettings(),
      q.listCards(),
      q.listCategories(),
      q.listSavingsGoals(),
      q.listTransactionsForMonth(selectedMonth),
      q.listTransferStatus(selectedMonth),
      q.resolveSavingsGoalAmounts(selectedMonth),
      q.resolveSalaryForMonth(selectedMonth),
      q.resolveCategoryLimits(selectedMonth),
      q.resolveRollovers(selectedMonth),
    ]);
    setSettings(s);
    setCards(c);
    setCategories(cat);
    setSavingsGoals(goals);
    setTransactions(tx);
    setSurplus(q.computeSurplusFrom(salary, tx, goals, transfers, goalAmounts));
    setCategorySummaries(q.computeCategorySummariesFrom(cat, tx, limitOverrides, rollovers));
    setCardTotals(q.computeCardTotalsFrom(tx));
    setTransferStatus(transfers);
    setSavingsGoalAmounts(goalAmounts);
  }, [selectedMonth]);

  useEffect(() => {
    (async () => {
      await seedDefaultCategoriesIfEmpty();
      await addPostLaunchCategoriesIfMissing();
      await seedDefaultSavingsGoalsIfEmpty();
      // Sharing is NOT wired up here. Activation depends on the auth session,
      // which restores asynchronously — sampling it once at boot meant a device
      // that signed in a moment later stayed local-only for the whole session,
      // silently not even journaling its writes. The effect below owns it and
      // re-runs whenever the session or the household changes.
      setSyncEnabled(false);
      // Auto-post any recurring bills that have come due since the last launch.
      await processRecurringTransactions();
      await refresh();
      setReady(true);
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

  // ── Sharing ───────────────────────────────────────────────────────────────
  // A household IS the shared budget. "Just my devices" and "share with my
  // wife" differ only in who else is a member, so both must go through the same
  // guarded transitions below. The bug these guards close: two screens each
  // created a household without checking, leaving one account in five of them
  // with no screen ever saying which one this device was actually on.
  const syncNow = useCallback(async () => {
    if (getActiveHouseholdId() && getCloudKitAdapter().isAvailable) {
      await runCloudKitSyncCycle();
      await refresh();
    }
  }, [refresh]);

  // Create a household seeded from this device's current budget, then co-edit it.
  const createAndJoinHousehold = useCallback(
    async (name?: string, opts?: { evenIfAlreadyAMember?: boolean }): Promise<SharingResult> => {
      // Creating while this device is already on a shared budget forks it: the
      // other person keeps editing the old household and neither side is told.
      if (settings.householdId) {
        return {
          success: false,
          message: 'This device is already on a shared budget. Invite the other person into it, or turn sharing off first.',
        };
      }
      // Even with sharing off locally, this account may still be a member of a
      // household holding the real budget. Creating another one is only allowed
      // once the caller has shown the user that list and they chose anyway.
      if (!opts?.evenIfAlreadyAMember) {
        const mine = await myHouseholdsResult();
        if (!mine.success) return { success: false, message: COULD_NOT_CHECK };
        if ((mine.data?.length ?? 0) > 0) {
          return {
            success: false,
            message: 'This account already belongs to a shared budget. Use that one, or confirm that you want a separate second budget.',
          };
        }
      }
      const res = await createHouseholdRpc(name);
      if (!res.success || !res.data) return res;
      await seedHouseholdFromLocal(res.data);
      activateHousehold(res.data);
      await updateSettings({ householdId: res.data });
      await runCloudKitSyncCycle();
      await refresh();
      return { success: true, message: 'Shared budget created. Send an invite code to bring someone into it.' };
    },
    [settings.householdId, refresh, updateSettings]
  );

  // Join an existing household by invite code and pull its shared budget.
  const joinExistingHousehold = useCallback(
    async (code: string, mode: JoinMode = 'merge'): Promise<SharingResult> => {
      const previous = settings.householdId;
      const res = await joinHouseholdRpc(code);
      if (!res.success || !res.data) return res;
      const householdId = res.data;
      if (previous === householdId) {
        return { success: true, message: 'This device was already on that shared budget.' };
      }
      // Drop the previous membership. Leaving it in place is what let one
      // account accumulate households, any of which a later "turn sync on"
      // could pick up instead of the one holding the real budget. Ordered after
      // the join so a bad code never costs the household you were in.
      if (previous) await leaveHouseholdRpc(previous);

      if (mode === 'replace') {
        // Everything destructive happens strictly AFTER the join is known to
        // have succeeded: a wrong code, an expired invite or a dead connection
        // must cost the user nothing. From here the join is real, so the worst
        // remaining case is an empty device with the data still in the cloud.
        await clearLocalBudgetData();
        await resetSyncTokenForHousehold(householdId);
      }

      activateHousehold(householdId);
      // Committed before the pull: the pull reads app_settings.householdId to
      // pick which household's watermark it is following.
      await updateSettings({ householdId });

      if (mode === 'replace') {
        // Pull only, never the full cycle. The outbox went with the local rows,
        // so there is nothing of ours left to push — and a push here is exactly
        // what would leak the just-wiped rows into someone else's budget.
        const pull = await pullChangesFromCloudKit();
        await refresh();
        if (!pull.success) {
          // The device is empty and the shared budget has not arrived. Say so —
          // it is recoverable (the watermark is still cleared, so any later sync
          // replays the whole household), but only if the user knows to retry.
          return {
            success: false,
            message:
              'Joined, but the shared budget could not be downloaded, so this device is empty right now. Nothing was lost from the shared budget. Tap Sync now once you are back online.',
          };
        }
        // A successful pull of nothing leaves a blank app, which looks exactly
        // like a bug unless we say which of the two it is.
        if (pull.pulledCount === 0) {
          return {
            success: true,
            message: 'Joined, but that shared budget has nothing in it yet, so this device is empty. It fills in as they add to it.',
          };
        }
        return { success: true, message: 'Joined. This device now shows the shared budget.' };
      }

      await runCloudKitSyncCycle();
      await refresh();
      return {
        success: true,
        message: previous
          ? 'Joined. This device left the shared budget it was on before.'
          : 'Joined. You now edit one budget together.',
      };
    },
    [settings.householdId, refresh, updateSettings]
  );

  // Point this device at a household the account is ALREADY a member of — the
  // second-device and resume-after-pause path. Never creates, never joins.
  const connectToHousehold = useCallback(
    async (householdId: string): Promise<SharingResult> => {
      if (settings.householdId === householdId) return { success: true, message: 'This device already uses that shared budget.' };
      if (settings.householdId) {
        return { success: false, message: 'Turn sharing off on this device first, then choose the other shared budget.' };
      }
      const mine = await myHouseholdsResult();
      if (!mine.success) return { success: false, message: COULD_NOT_CHECK };
      const target = mine.data?.find((h) => h.id === householdId);
      // Membership can end elsewhere (the owner removed you). Activating anyway
      // would journal writes RLS then rejects — sync that looks on but isn't.
      if (!target) {
        return { success: false, message: 'This account is no longer a member of that shared budget. Ask for a new invite code.' };
      }
      activateHousehold(householdId);
      await updateSettings({ householdId });
      await runCloudKitSyncCycle();
      await refresh();
      return { success: true, message: `This device now syncs with ${target.name}.` };
    },
    [settings.householdId, refresh, updateSettings]
  );

  const leaveCurrentHousehold = useCallback(async (): Promise<SharingResult> => {
    const hid = getActiveHouseholdId() ?? settings.householdId;
    if (hid) await leaveHouseholdRpc(hid);
    deactivateHousehold();
    await updateSettings({ householdId: null });
    await refresh();
    return { success: true, message: 'Left the shared budget. The copy on this device stays and keeps working offline.' };
  }, [refresh, updateSettings, settings.householdId]);

  // "Just my devices" — the same household machinery with one member. Reuses
  // the household this account already has whenever there is exactly one, and
  // refuses to guess when there are several. Opt-in only.
  const startDeviceSync = useCallback(async (): Promise<SharingResult> => {
    if (settings.householdId) return { success: true, message: 'Sync is already on for this device.' };
    const mine = await myHouseholdsResult();
    // Treating an unreachable server as "no households" is what made a second
    // device create its own budget instead of joining the one that existed.
    if (!mine.success) return { success: false, message: COULD_NOT_CHECK };
    const households = mine.data ?? [];
    if (households.length === 1) return connectToHousehold(households[0].id);
    if (households.length > 1) {
      return {
        success: false,
        message: 'This account belongs to more than one shared budget. Choose which one this device should use.',
      };
    }
    return createAndJoinHousehold('My devices', { evenIfAlreadyAMember: true });
  }, [settings.householdId, connectToHousehold, createAndJoinHousehold]);

  // Stops syncing on THIS device only and keeps the membership, so resuming is
  // one tap and the other devices/people are untouched. Local data stays.
  const pauseSharing = useCallback(async (): Promise<SharingResult> => {
    deactivateHousehold();
    await updateSettings({ householdId: null });
    await refresh();
    return { success: true, message: 'Sync is off on this device. Your budget stays here.' };
  }, [updateSettings, refresh]);

  // Sharing is a function of (signed-in session × chosen household), so it is
  // derived from that state rather than switched on once at launch. Whenever
  // either changes — session restores, user signs in or out, household joined
  // or left — this re-runs and puts the sync engine in the matching state.
  useEffect(() => {
    if (!ready) return;
    const householdId = settings.householdId;
    if (householdId && session && isSupabaseConfigured) {
      activateHousehold(householdId);
      runCloudKitSyncCycle().then(() => refresh());
    } else {
      // No session (or local-only): stop journaling so writes aren't queued
      // against a household this device can no longer prove membership of.
      deactivateHousehold();
    }
  }, [ready, settings.householdId, session?.user?.id, refresh]);

  // Live updates: a co-editor's write should land here in about a round-trip,
  // not whenever the next poll happens to fire.
  useEffect(() => {
    if (!ready || !settings.householdId || !session) return;
    const sub = subscribeToHousehold(settings.householdId, () => {
      syncNow();
    });
    return () => sub.unsubscribe();
  }, [ready, settings.householdId, session?.user?.id, syncNow]);

  // Pull shared changes when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow();
    });
    return () => sub.remove();
  }, [syncNow]);

  // Safety net behind Realtime: a dropped socket, a backgrounded app or a
  // paused project would otherwise strand this device silently. Redundant with
  // a live event, which is fine — the change token makes an extra pull a no-op.
  useEffect(() => {
    if (!settings.householdId) return;
    const id = setInterval(() => {
      if (AppState.currentState === 'active') syncNow();
    }, 30_000);
    return () => clearInterval(id);
  }, [settings.householdId, syncNow]);

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

  // MEMOISED, and it has to be. Every screen in the app reads this one context,
  // so a fresh object here re-renders all of them — the whole tab tree, every
  // list row, every chart — on any render of this provider, whether or not the
  // data those screens use actually changed. That is the "buttons feel laggy"
  // symptom: a tap's visual feedback queues behind a full re-render of the app.
  // The action callbacks below are all useCallback'd so this list is stable.
  const value: BudgetContextValue = useMemo(
    () => ({
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
      connectToHousehold,
      startDeviceSync,
      pauseSharing,
      leaveHousehold: leaveCurrentHousehold,
    }),
    [
      ready,
      selectedMonth,
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
      createAndJoinHousehold,
      joinExistingHousehold,
      connectToHousehold,
      startDeviceSync,
      pauseSharing,
      leaveCurrentHousehold,
    ]
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget(): BudgetContextValue {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget must be used within BudgetProvider');
  return ctx;
}

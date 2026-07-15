import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import { resolveCategoryLimits } from '../lib/queries';
import type { Streak, CalendarEvent, MonthlySummary } from './models';

// ---------- Streaks ----------

export async function updateLoggingStreak(): Promise<void> {
  const db = await getDb();
  const today = new Date().toISOString().split('T')[0];
  
  const streak = await db.getFirstAsync<Streak>("SELECT * FROM streaks WHERE type = 'logging'");
  
  if (!streak) {
    await db.runAsync(
      "INSERT INTO streaks (id, type, currentStreak, longestStreak, lastActiveDate) VALUES (?, 'logging', 1, 1, ?)",
      [uuid(), today]
    );
    return;
  }
  
  if (streak.lastActiveDate === today) return; // Already logged today
  
  const lastDate = new Date(streak.lastActiveDate + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000);
  
  let newStreak = 1;
  if (diffDays === 1) {
    newStreak = streak.currentStreak + 1;
  }
  
  const longest = Math.max(newStreak, streak.longestStreak);
  
  await db.runAsync(
    "UPDATE streaks SET currentStreak = ?, longestStreak = ?, lastActiveDate = ? WHERE id = ?",
    [newStreak, longest, today, streak.id]
  );
}

export async function updateBudgetStreak(yearMonth: string): Promise<void> {
  const db = await getDb();
  
  const limits = await resolveCategoryLimits(yearMonth);
  const txs = await db.getAllAsync<{ categoryId: string; amount: number }>(
    "SELECT categoryId, amount FROM transactions WHERE strftime('%Y-%m', date) = ? AND categoryId IS NOT NULL",
    [yearMonth]
  );
  
  const spendByCat = new Map<string, number>();
  for (const t of txs) {
    spendByCat.set(t.categoryId, (spendByCat.get(t.categoryId) || 0) + t.amount);
  }
  
  let allUnder = true;
  for (const [catId, limit] of limits.entries()) {
    if (limit > 0 && (spendByCat.get(catId) || 0) > limit) {
      allUnder = false;
      break;
    }
  }
  
  const today = new Date().toISOString().split('T')[0];
  const streak = await db.getFirstAsync<Streak>("SELECT * FROM streaks WHERE type = 'under_budget'");
  
  if (!streak) {
    if (allUnder) {
      await db.runAsync(
        "INSERT INTO streaks (id, type, currentStreak, longestStreak, lastActiveDate) VALUES (?, 'under_budget', 1, 1, ?)",
        [uuid(), today]
      );
    }
    return;
  }
  
  const newStreak = allUnder ? streak.currentStreak + 1 : 0;
  const longest = Math.max(newStreak, streak.longestStreak);
  
  await db.runAsync(
    "UPDATE streaks SET currentStreak = ?, longestStreak = ?, lastActiveDate = ? WHERE id = ?",
    [newStreak, longest, today, streak.id]
  );
}

export async function getStreaks(): Promise<{ logging: Streak | null; budget: Streak | null }> {
  const db = await getDb();
  const logging = await db.getFirstAsync<Streak>("SELECT * FROM streaks WHERE type = 'logging'");
  const budget = await db.getFirstAsync<Streak>("SELECT * FROM streaks WHERE type = 'under_budget'");
  return { logging, budget };
}

// ---------- Rollover ----------

export async function setCategoryRolloverEnabled(categoryId: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE categories SET rolloverEnabled = ? WHERE id = ?', [enabled ? 1 : 0, categoryId]);
}

export async function getCategoryRolloverEnabled(categoryId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ rolloverEnabled: number }>(
    'SELECT rolloverEnabled FROM categories WHERE id = ?',
    [categoryId]
  );
  return !!row?.rolloverEnabled;
}

export async function getCategoryBudgetWithRollover(
  categoryId: string, 
  yearMonth: string
): Promise<{ budget: number; rollover: number; effectiveBudget: number }> {
  const db = await getDb();
  const category = await db.getFirstAsync<{ rolloverEnabled: number }>("SELECT rolloverEnabled FROM categories WHERE id = ?", [categoryId]);
  
  const limits = await resolveCategoryLimits(yearMonth);
  const baseBudget = limits.get(categoryId) || 0;
  
  if (!category || !category.rolloverEnabled) {
    return { budget: baseBudget, rollover: 0, effectiveBudget: baseBudget };
  }
  
  // Get prev month
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  
  const prevLimits = await resolveCategoryLimits(prevMonth);
  const prevBudget = prevLimits.get(categoryId) || 0;
  
  const prevSpend = await db.getFirstAsync<{ total: number }>(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions
    WHERE categoryId = ? AND strftime('%Y-%m', date) = ?
  `, [categoryId, prevMonth]);
  
  const rollover = Math.max(0, prevBudget - (prevSpend?.total || 0));
  
  return {
    budget: baseBudget,
    rollover,
    effectiveBudget: baseBudget + rollover
  };
}

// ---------- Bill Calendar ----------

export async function getCalendarEventsForMonth(yearMonth: string): Promise<CalendarEvent[]> {
  const db = await getDb();
  const events: CalendarEvent[] = [];
  
  // Recurring
  const recurring = await db.getAllAsync<{ note: string; amount: number; dayOfMonth: number; categoryId: string }>(`
    SELECT note, amount, dayOfMonth, categoryId 
    FROM recurring_transactions 
    WHERE active = 1
  `);
  
  for (const r of recurring) {
    events.push({ day: r.dayOfMonth, label: r.note, amount: r.amount, type: 'bill', color: '#FF6B6B' });
  }
  
  // Cards
  const cards = await db.getAllAsync<{ name: string; dueDay: number }>(`
    SELECT name, dueDay FROM cards WHERE dueDay IS NOT NULL
  `);
  
  for (const c of cards) {
    events.push({ day: c.dueDay, label: `${c.name} Due`, amount: 0, type: 'due_date', color: '#FFB347' });
  }
  
  return events.sort((a, b) => a.day - b.day);
}

// ---------- Monthly Summary ----------

export async function generateMonthlySummary(yearMonth: string): Promise<MonthlySummary> {
  const db = await getDb();
  
  const totalSpent = await db.getFirstAsync<{total: number}>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE strftime('%Y-%m', date) = ?`, [yearMonth]
  );
  
  const topCategories = await db.getAllAsync<{ categoryId: string; name: string; total: number }>(`
    SELECT t.categoryId as categoryId, c.name as name, SUM(t.amount) as total
    FROM transactions t
    JOIN categories c ON t.categoryId = c.id
    WHERE strftime('%Y-%m', t.date) = ? AND t.categoryId IS NOT NULL
    GROUP BY t.categoryId ORDER BY total DESC LIMIT 3
  `, [yearMonth]);
  
  const biggestPurchase = await db.getFirstAsync<{note: string | null, amount: number}>(`
    SELECT note, amount FROM transactions
    WHERE strftime('%Y-%m', date) = ? ORDER BY amount DESC LIMIT 1
  `, [yearMonth]);
  
  const transactionCount = await db.getFirstAsync<{count: number}>(
    `SELECT COUNT(*) as count FROM transactions WHERE strftime('%Y-%m', date) = ?`, [yearMonth]
  );
  
  // Budget Score
  const limits = await resolveCategoryLimits(yearMonth);
  let totalCats = 0;
  let underBudgetCats = 0;
  
  const txs = await db.getAllAsync<{ categoryId: string; amount: number }>(
    "SELECT categoryId, amount FROM transactions WHERE strftime('%Y-%m', date) = ? AND categoryId IS NOT NULL",
    [yearMonth]
  );
  const spendByCat = new Map<string, number>();
  for (const t of txs) spendByCat.set(t.categoryId, (spendByCat.get(t.categoryId) || 0) + t.amount);
  
  for (const [catId, limit] of limits.entries()) {
    if (limit > 0) {
      totalCats++;
      if ((spendByCat.get(catId) || 0) <= limit) {
        underBudgetCats++;
      }
    }
  }
  
  const budgetScore = totalCats > 0 ? Math.round((underBudgetCats / totalCats) * 100) : 100;
  
  return {
    yearMonth,
    totalSpent: totalSpent?.total || 0,
    topCategories,
    biggestPurchase: biggestPurchase || null,
    transactionCount: transactionCount?.count || 0,
    budgetScore
  };
}

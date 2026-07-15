import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import type { RecurringTransaction } from './models';

export async function listRecurringTransactions(): Promise<RecurringTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<RecurringTransaction>('SELECT * FROM recurring_transactions ORDER BY dayOfMonth ASC');
}

export async function createRecurringTransaction(input: Omit<RecurringTransaction, 'id' | 'nextPostDate'>): Promise<RecurringTransaction> {
  const db = await getDb();
  const nextPostDate = calculateNextPostDate(new Date().toISOString().split('T')[0], input.dayOfMonth);
  const r: RecurringTransaction = { id: uuid(), ...input, nextPostDate };
  await db.runAsync(
    'INSERT INTO recurring_transactions (id, note, amount, categoryId, cardId, dayOfMonth, nextPostDate, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [r.id, r.note, r.amount, r.categoryId, r.cardId, r.dayOfMonth, r.nextPostDate, r.active ? 1 : 0]
  );
  return r;
}

export async function updateRecurringTransaction(id: string, patch: Partial<Omit<RecurringTransaction, 'id'>>): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<RecurringTransaction>('SELECT * FROM recurring_transactions WHERE id = ?', [id]);
  if (!existing) return;
  const next = { ...existing, ...patch };
  
  if (patch.dayOfMonth !== undefined && patch.dayOfMonth !== existing.dayOfMonth) {
    next.nextPostDate = calculateNextPostDate(new Date().toISOString().split('T')[0], next.dayOfMonth);
  }

  await db.runAsync(
    'UPDATE recurring_transactions SET note = ?, amount = ?, categoryId = ?, cardId = ?, dayOfMonth = ?, nextPostDate = ?, active = ? WHERE id = ?',
    [next.note, next.amount, next.categoryId, next.cardId, next.dayOfMonth, next.nextPostDate, next.active ? 1 : 0, id]
  );
}

export async function deleteRecurringTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM recurring_transactions WHERE id = ?', [id]);
}

export async function toggleRecurringTransaction(id: string, active: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE recurring_transactions SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
}

export function calculateNextPostDate(currentDateStr: string, targetDay: number): string {
  const d = new Date(currentDateStr + 'T00:00:00');
  
  if (d.getDate() > targetDay) {
    d.setMonth(d.getMonth() + 1);
  } else if (d.getDate() === targetDay) {
    // If today is exactly the target day, we assume it's for next month (if calling this after processing today)
    d.setMonth(d.getMonth() + 1);
  }
  
  // Set day, clamping if month doesn't have that many days
  d.setDate(1); // Reset to 1st to avoid overflow issues
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDayOfMonth));
  
  return d.toISOString().split('T')[0];
}

export async function processRecurringTransactions(): Promise<number> {
  const db = await getDb();
  const todayStr = new Date().toISOString().split('T')[0];
  
  let processedCount = 0;
  
  await db.withTransactionAsync(async () => {
    const due = await db.getAllAsync<RecurringTransaction>(
      'SELECT * FROM recurring_transactions WHERE active = 1 AND nextPostDate <= ?',
      [todayStr]
    );
    
    for (const r of due) {
      const txId = uuid();
      const createdAt = new Date().toISOString();
      await db.runAsync(
        'INSERT INTO transactions (id, amount, date, categoryId, cardId, note, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, r.amount, r.nextPostDate, r.categoryId, r.cardId, r.note, 'recurring', createdAt]
      );
      
      const newNextPostDate = calculateNextPostDate(r.nextPostDate, r.dayOfMonth);
      await db.runAsync(
        'UPDATE recurring_transactions SET nextPostDate = ? WHERE id = ?',
        [newNextPostDate, r.id]
      );
      processedCount++;
    }
  });
  
  return processedCount;
}

export async function discoverRecurringPatterns(): Promise<Array<{ note: string; amount: number; dayOfMonth: number; confidence: number }>> {
  const db = await getDb();
  // Find transactions with same amount and similar note, occurring 3+ times
  const groups = await db.getAllAsync<{ note: string; amount: number; count: number; firstDate: string; lastDate: string }>(`
    SELECT 
      LOWER(note) as notePattern, 
      note,
      ROUND(amount, 2) as amount, 
      COUNT(*) as count,
      MIN(date) as firstDate,
      MAX(date) as lastDate
    FROM transactions 
    WHERE note IS NOT NULL AND note != ''
    GROUP BY LOWER(note), ROUND(amount, 2)
    HAVING COUNT(*) >= 3
  `);
  
  const suggestions = [];
  
  for (const g of groups) {
    const txs = await db.getAllAsync<{ date: string }>(
      'SELECT date FROM transactions WHERE LOWER(note) = ? AND ROUND(amount, 2) = ? ORDER BY date ASC',
      [g.note.toLowerCase(), g.amount]
    );
    
    let isConsistent = true;
    for (let i = 1; i < txs.length; i++) {
      const d1 = new Date(txs[i-1].date + 'T00:00:00');
      const d2 = new Date(txs[i].date + 'T00:00:00');
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
      
      if (diffDays < 25 || diffDays > 35) { // Roughly monthly
        isConsistent = false;
        break;
      }
    }
    
    if (isConsistent) {
      const lastDate = new Date(g.lastDate + 'T00:00:00');
      suggestions.push({
        note: g.note,
        amount: g.amount,
        dayOfMonth: lastDate.getDate(),
        confidence: Math.min(0.99, 0.5 + (g.count * 0.1)) // More occurrences = higher confidence
      });
    }
  }
  
  return suggestions;
}

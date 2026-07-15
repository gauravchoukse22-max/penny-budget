import { getDb } from '../lib/db';

/**
 * Instantly updates the category for a large batch of transactions.
 * Uses a single SQL transaction for maximum performance.
 */
export async function bulkUpdateCategory(transactionIds: string[], newCategoryId: string | null): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;
  
  const db = await getDb();
  
  // Create placeholders string: e.g. "?, ?, ?"
  const placeholders = transactionIds.map(() => '?').join(', ');
  
  const sql = `UPDATE transactions SET categoryId = ? WHERE id IN (${placeholders})`;
  
  const params = [newCategoryId, ...transactionIds];
  
  let changes = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(sql, params);
    changes = result.changes;
  });
  
  return changes;
}

/**
 * Bulk deletes transactions. Extremely useful for test data or mistakes.
 */
export async function bulkDeleteTransactions(transactionIds: string[]): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;
  
  const db = await getDb();
  const placeholders = transactionIds.map(() => '?').join(', ');
  const sql = `DELETE FROM transactions WHERE id IN (${placeholders})`;
  
  let changes = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(sql, transactionIds);
    changes = result.changes;
  });
  
  return changes;
}

/**
 * Bulk updates the card source for transactions.
 */
export async function bulkUpdateCard(transactionIds: string[], newCardId: string): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;
  
  const db = await getDb();
  const placeholders = transactionIds.map(() => '?').join(', ');
  const sql = `UPDATE transactions SET cardId = ? WHERE id IN (${placeholders})`;
  
  const params = [newCardId, ...transactionIds];
  
  let changes = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(sql, params);
    changes = result.changes;
  });
  
  return changes;
}

import { getDb } from '../lib/db';
import { chunkIds, journalRowsAsUpdates } from '../lib/queries';
import { queueSyncMutation } from './cloudkit-sync';
import { transactionFundEntryId } from './funds';

// Every write below is journalled to the outbox inside the same SQL transaction
// as the write itself, so a bulk edit can never commit locally without the
// mutation the other household member needs (AGENTS.md §2). The id list comes
// from a user selection with no upper bound, so both the write and the journal
// read are chunked to stay under SQLite's bound-parameter cap.

/**
 * Instantly updates the category for a large batch of transactions.
 * Uses a single SQL transaction for maximum performance.
 */
export async function bulkUpdateCategory(transactionIds: string[], newCategoryId: string | null): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;

  const db = await getDb();

  let changes = 0;
  await db.withTransactionAsync(async () => {
    for (const chunk of chunkIds(transactionIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await db.runAsync(`UPDATE transactions SET categoryId = ? WHERE id IN (${placeholders})`, [
        newCategoryId,
        ...chunk,
      ]);
      changes += result.changes;
    }
    await journalRowsAsUpdates('transactions', transactionIds);
  });

  return changes;
}

/**
 * Bulk deletes transactions. Extremely useful for test data or mistakes.
 */
export async function bulkDeleteTransactions(transactionIds: string[]): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;

  const db = await getDb();

  let changes = 0;
  await db.withTransactionAsync(async () => {
    // Read the ids that actually exist before removing them — journalling a
    // DELETE for an id that was already gone would push a tombstone for a row
    // the other device may never have had.
    const deletedIds: string[] = [];
    for (const chunk of chunkIds(transactionIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const present = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM transactions WHERE id IN (${placeholders})`,
        chunk
      );
      deletedIds.push(...present.map((row) => row.id));
      const result = await db.runAsync(`DELETE FROM transactions WHERE id IN (${placeholders})`, chunk);
      changes += result.changes;
    }
    for (const id of deletedIds) await queueSyncMutation('DELETE', 'transactions', id, { id });

    // A charge paid out of a fund owns a withdrawal in the Funds ledger, keyed
    // to its id. Nothing cascades here (AGENTS.md §2), so deleting the charges
    // without this leaves the funds permanently low, with history lines
    // pointing at purchases that no longer exist. Only the entries that really
    // existed are journaled — a tombstone for an id the co-member never had
    // asks them to delete nothing, which is the same guard the loop above uses.
    const strandedEntryIds = deletedIds.map(transactionFundEntryId);
    for (const chunk of chunkIds(strandedEntryIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const present = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM fund_entries WHERE id IN (${placeholders})`,
        chunk
      );
      if (present.length === 0) continue;
      await db.runAsync(`DELETE FROM fund_entries WHERE id IN (${placeholders})`, chunk);
      for (const row of present) await queueSyncMutation('DELETE', 'fund_entries', row.id, { id: row.id });
    }
  });

  return changes;
}

/**
 * Bulk updates the card source for transactions.
 */
export async function bulkUpdateCard(transactionIds: string[], newCardId: string): Promise<number> {
  if (!transactionIds || transactionIds.length === 0) return 0;

  const db = await getDb();

  let changes = 0;
  await db.withTransactionAsync(async () => {
    for (const chunk of chunkIds(transactionIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await db.runAsync(`UPDATE transactions SET cardId = ? WHERE id IN (${placeholders})`, [
        newCardId,
        ...chunk,
      ]);
      changes += result.changes;
    }
    await journalRowsAsUpdates('transactions', transactionIds);
  });

  return changes;
}

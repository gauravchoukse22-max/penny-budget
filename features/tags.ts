// ---------------------------------------------------------------------------
// features/tags.ts – Storage for cross-category tags.
//
// lib/tags.ts owns the identity rules (how a name becomes an id, how two names
// compare, how totals add up) and is pure so the harness can run it. This file
// owns the two tables and, critically, the journaling.
//
// Sync contract: EVERY write below journals through queueSyncMutation, because
// a local write that does not journal never reaches the other member of a
// shared household and nothing surfaces the failure (AGENTS.md rule 2). Both
// `tags` and `transaction_tags` are in SYNCABLE_TABLES.
//
// ── Orphans ─────────────────────────────────────────────────────────────────
// Foreign keys are NOT enforced in this database, so the schema's cascades
// never fire and every join row has to be swept by hand — an orphan is not
// harmless here, it keeps counting toward a tag's total with no transaction
// left to explain the money. There are two sweeps because there are two ways
// to orphan a row:
//
//   • deleteTag()               — the tag side, swept immediately.
//   • clearTagsForTransaction() — the transaction side, called from the
//                                 delete paths this feature can reach.
//
// lib/queries.ts deleteTransaction and features/bulk-actions.ts know nothing
// about tags, and a transaction deleted on the OTHER phone arrives as a sync
// tombstone that no local code path sees at all. So neither of the above is
// sufficient on its own, and sweepOrphanedTransactionTags() is the backstop
// that makes the total correct regardless of which path removed the row. It
// runs from listTagSummaries — i.e. immediately before the numbers that an
// orphan would corrupt, which is the one place it cannot be forgotten. Same
// reasoning as reconcileGoalFundEntries in lib/queries.ts: rebuild/verify at
// the point of use rather than trusting every caller to remember.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { attachSplits, chunkIds, journalUpsert } from '../lib/queries';
import {
  dedupeTagIds,
  normalizeTagName,
  tagColorFor,
  tagId as deriveTagId,
  tagJoinId,
  tagNameKey,
  tagTotals,
  validateTagName,
} from '../lib/tags';
import type { Transaction } from '../lib/models';
import { queueSyncMutation } from './cloudkit-sync';

export type Tag = {
  id: string;
  name: string;
  /** Lowercased `name`, stored so a case-insensitive lookup is an indexed
   * query rather than a full scan pulled into JS. */
  nameKey: string;
  color: string;
  createdAt: string;
};

export type TagSummary = Tag & {
  /** How many transactions carry this tag, across every month. */
  transactionCount: number;
  /** Their total, signed — refunds on tagged purchases pull it down. */
  total: number;
};

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  // Ordered by nameKey, not name: ordering by the display name puts every
  // capitalised tag ahead of every lowercase one, so "Vacation" and "beach"
  // sort into two blocks and the picker looks unsorted to the user.
  return db.getAllAsync<Tag>('SELECT * FROM tags ORDER BY nameKey ASC');
}

export async function listTagIdsForTransaction(transactionId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ tagId: string }>(
    'SELECT tagId FROM transaction_tags WHERE transactionId = ? ORDER BY id ASC',
    [transactionId]
  );
  return rows.map((r) => r.tagId);
}

/**
 * Tag ids for a whole page of transactions in ONE query.
 *
 * Per-row queries were the first cut and are why this exists: the transactions
 * list renders a few hundred rows for an imported month, and a query each made
 * changing month visibly stutter. Same fix, and same reason, as attachSplits in
 * lib/queries.ts.
 */
export async function tagIdsForTransactions(transactionIds: string[]): Promise<Map<string, string[]>> {
  const byTransaction = new Map<string, string[]>();
  if (transactionIds.length === 0) return byTransaction;
  const db = await getDb();
  // Chunked for the same reason as journalRowsAsUpdates: SQLite caps bound
  // parameters, and a month of imported statement rows can exceed it.
  for (const chunk of chunkIds(transactionIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.getAllAsync<{ transactionId: string; tagId: string }>(
      `SELECT transactionId, tagId FROM transaction_tags WHERE transactionId IN (${placeholders}) ORDER BY id ASC`,
      chunk
    );
    for (const row of rows) {
      const list = byTransaction.get(row.transactionId);
      if (list) list.push(row.tagId);
      else byTransaction.set(row.transactionId, [row.tagId]);
    }
  }
  return byTransaction;
}

/**
 * Every tag with its transaction count and total.
 *
 * The total uses each transaction's FULL amount even when it is split across
 * categories. That is correct and not an oversight: the tag is on the
 * transaction, and "what did the trip cost?" does not care that the hotel bill
 * was filed half under Travel and half under Dining.
 */
export async function listTagSummaries(): Promise<TagSummary[]> {
  await sweepOrphanedTransactionTags();
  const db = await getDb();
  const tags = await listTags();
  if (tags.length === 0) return [];

  const rows = await db.getAllAsync<{ tagId: string; amount: number }>(
    `SELECT tt.tagId AS tagId, t.amount AS amount
       FROM transaction_tags tt
       JOIN transactions t ON t.id = tt.transactionId`
  );

  // Summed in JS through tagTotals rather than with SQL's SUM(): amounts are
  // REAL, and summing hundreds of them in the database drifts by fractions of a
  // cent that then render as a trip total nobody can reconcile. lib/tags.ts
  // adds in whole cents.
  const totals = tagTotals(rows);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.tagId, (counts.get(row.tagId) ?? 0) + 1);

  return tags.map((tag) => ({
    ...tag,
    transactionCount: counts.get(tag.id) ?? 0,
    total: totals.get(tag.id) ?? 0,
  }));
}

/**
 * Every transaction carrying this tag, newest first, across EVERY month.
 *
 * Deliberately not month-scoped. A tag exists to answer a question the month
 * view cannot — a holiday that straddles July and August is one trip, and a
 * total that silently stopped at the month boundary would be worse than no
 * total, because it looks like an answer.
 */
export async function listTransactionsWithTag(tagId: string): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
       JOIN transaction_tags tt ON tt.transactionId = t.id
      WHERE tt.tagId = ?
      ORDER BY t.date DESC, t.createdAt DESC`,
    [tagId]
  );
  // Splits attached for the same reason lib/queries.ts's loaders do it: any
  // screen showing these rows renders per-category amounts from them.
  return attachSplits(rows);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Finds or creates the tag with this name, and returns it.
 *
 * INSERT OR IGNORE rather than INSERT OR REPLACE: the id is derived from the
 * name, so an existing row IS this tag, and replacing it would reset its
 * createdAt and overwrite the display capitalisation the user originally chose
 * with whatever they happened to type this time.
 *
 * The row is journaled by reading back what actually landed (journalUpsert)
 * rather than by pushing what we intended to write — for a tag that already
 * existed those differ, and the co-member should receive the row that is real
 * here, not the one we would have created.
 */
export async function ensureTag(rawName: string): Promise<Tag | null> {
  if (validateTagName(rawName) !== null) return null;
  const db = await getDb();
  const name = normalizeTagName(rawName);
  const id = deriveTagId(name);

  await db.runAsync(
    'INSERT OR IGNORE INTO tags (id, name, nameKey, color, createdAt) VALUES (?, ?, ?, ?, ?)',
    [id, name, tagNameKey(name), tagColorFor(name), new Date().toISOString()]
  );
  await journalUpsert('tags', 'id = ?', [id]);
  return db.getFirstAsync<Tag>('SELECT * FROM tags WHERE id = ?', [id]);
}

/**
 * Removes a tag and every join row pointing at it.
 *
 * The join rows go first and each one is journaled INDIVIDUALLY. The sync
 * mirror is keyed per record, so a bulk `DELETE FROM transaction_tags WHERE
 * tagId = ?` that journaled nothing would leave the other device holding every
 * one of those rows — its tag picker would still show a tag this device has
 * deleted, and any total built from those rows would stay wrong forever. Same
 * shape as deleteSplitsFor / deleteSavingsGoal in lib/queries.ts.
 */
export async function deleteTag(id: string): Promise<void> {
  const db = await getDb();
  const joins = await db.getAllAsync<{ id: string }>('SELECT id FROM transaction_tags WHERE tagId = ?', [id]);
  await db.runAsync('DELETE FROM transaction_tags WHERE tagId = ?', [id]);
  await db.runAsync('DELETE FROM tags WHERE id = ?', [id]);
  for (const join of joins) await queueSyncMutation('DELETE', 'transaction_tags', join.id, { id: join.id });
  await queueSyncMutation('DELETE', 'tags', id, { id });
}

/**
 * Replace a transaction's tags with exactly this set.
 *
 * Diffed rather than delete-then-reinsert (which is what setTransactionSplits
 * does). Split ids are derived from a part INDEX, so editing them shifts every
 * id and wholesale replacement is the only correct move there. A join id is
 * derived from (transactionId, tagId), so a tag that stays put keeps the exact
 * same id — deleting and re-adding it would journal a DELETE and a CREATE for
 * one unchanged row, and those two land on the co-member in whatever order the
 * outbox's millisecond timestamps happen to sort. Touching only what actually
 * changed removes that race instead of relying on it resolving favourably.
 */
export async function setTransactionTags(transactionId: string, tagIds: string[]): Promise<void> {
  const db = await getDb();
  const wanted = new Set(dedupeTagIds(tagIds));
  const current = new Set(await listTagIdsForTransaction(transactionId));

  for (const tagId of current) {
    if (wanted.has(tagId)) continue;
    const joinId = tagJoinId(transactionId, tagId);
    await db.runAsync('DELETE FROM transaction_tags WHERE id = ?', [joinId]);
    await queueSyncMutation('DELETE', 'transaction_tags', joinId, { id: joinId });
  }

  for (const tagId of wanted) {
    if (current.has(tagId)) continue;
    const row = { id: tagJoinId(transactionId, tagId), transactionId, tagId };
    await db.runAsync(
      'INSERT OR REPLACE INTO transaction_tags (id, transactionId, tagId) VALUES (?, ?, ?)',
      [row.id, row.transactionId, row.tagId]
    );
    await queueSyncMutation('CREATE', 'transaction_tags', row.id, row);
  }
}

/**
 * Drops every tag from one transaction. Call BEFORE deleting the transaction,
 * while its join rows are still readable — afterwards they are orphans that
 * only the sweep can find.
 */
export async function clearTagsForTransaction(transactionId: string): Promise<void> {
  await setTransactionTags(transactionId, []);
}

/**
 * Deletes join rows whose transaction no longer exists, and journals each one.
 *
 * The backstop described in the file header. It exists because the delete paths
 * that can strand a join row are not all reachable from here: lib/queries.ts
 * deleteTransaction, features/bulk-actions.ts bulkDeleteTransactions, and a
 * transaction tombstoned on the OTHER phone and applied by the sync pull. An
 * orphan is not cosmetic — it keeps its transaction's amount in the tag total
 * after the transaction is gone, so the trip total quietly stops matching the
 * transactions listed under it.
 *
 * Returns how many it removed, so a caller can tell "nothing to do" from "this
 * just corrected a total".
 */
export async function sweepOrphanedTransactionTags(): Promise<number> {
  const db = await getDb();
  const orphans = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM transaction_tags WHERE transactionId NOT IN (SELECT id FROM transactions)'
  );
  if (orphans.length === 0) return 0;
  for (const orphan of orphans) {
    await db.runAsync('DELETE FROM transaction_tags WHERE id = ?', [orphan.id]);
    await queueSyncMutation('DELETE', 'transaction_tags', orphan.id, { id: orphan.id });
  }
  return orphans.length;
}

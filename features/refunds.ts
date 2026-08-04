// ---------------------------------------------------------------------------
// features/refunds.ts – "I expect this money back."
//
// You return a jacket, you front a work expense, a duplicate charge lands. The
// money has left the account and the budget correctly says so — but it is money
// you are owed, and until it arrives nothing in the app can tell you how much
// is outstanding or that the $60 you were promised in June never actually
// showed up. That is the whole feature: an outstanding total that stays on
// screen until each claim lands. Simplifi ships the small version of this and
// it is the part people keep.
//
// ── Why its own table, not columns on `transactions` ────────────────────────
// Decided in features/db-migrations.ts alongside the schema; the short form:
//  1. A new column on `transactions` rides along in every transaction sync
//     payload, and a household member on a build without the migration THROWS
//     applying it — inside the pull's transaction, so it stalls their whole
//     sync, not just that row. A new table is absent from their SYNCABLE_TABLES
//     and is skipped harmlessly instead.
//  2. A claim is several facts (expected amount, status, when it landed), which
//     as columns would be dead weight on every transaction ever created.
//  3. It is sparse — a handful of rows against thousands of transactions.
//
// ── Not to be confused with the "Refund / credit" toggle ────────────────────
// The transaction screens already have a Refund/Credit switch. That one flips
// the SIGN of an amount: money that has already come back. This is the other
// half — money that has NOT come back yet. A claim hangs off the original
// expense; when it lands, the user marks it received (and, if they want the
// money reflected in the budget, enters the actual credit as its own negative
// transaction, exactly as their bank statement shows it). Deliberately NOT
// automatic: inventing a transaction the bank has not confirmed is how a budget
// starts disagreeing with the account it is supposed to mirror.
//
// Sync contract: every write journals through queueSyncMutation (AGENTS.md rule
// 2), and `refund_claims` is in SYNCABLE_TABLES.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { chunkIds, journalUpsert } from '../lib/queries';
import type { Transaction } from '../lib/models';
import { queueSyncMutation } from './cloudkit-sync';

export type RefundStatus = 'awaiting' | 'received';

export type RefundClaim = {
  id: string;
  transactionId: string;
  /**
   * How much is expected BACK, stored positive.
   *
   * Separate from the transaction's own amount because partial refunds are the
   * normal case, not the exception: a $200 order with one $60 item returned is
   * $60 outstanding. Defaulting it to the full amount and offering it for edit
   * is what makes the common case one tap and the partial case possible at all.
   */
  expectedAmount: number;
  status: RefundStatus;
  note: string | null;
  createdAt: string;
  /** When it was marked received. Null while awaiting. */
  resolvedAt: string | null;
};

/** A claim with the transaction it hangs off, for the outstanding list. */
export type OutstandingClaim = RefundClaim & { transaction: Transaction };

// ── Money helpers (same convention as features/net-worth.ts) ────────────────

/** Money is cents — collapse float dust before it reaches the database. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

// ── Pure helpers (covered by scripts/test-tags.mjs) ─────────────────────────

/**
 * A claim's primary key, derived from the transaction it belongs to.
 *
 * One claim per transaction, so both phones marking the same purchase produce
 * the SAME row and last-writer-wins merges them. With uuid() they would be two
 * claims, and the outstanding total — the single number this feature exists to
 * show — would be double. AGENTS.md rule 2; same precedent as
 * `nw-<yearMonth>` and `split-<transactionId>-<index>`.
 */
export function refundClaimId(transactionId: string): string {
  return `refund-${transactionId}`;
}

/**
 * What is still owed across a set of claims.
 *
 * Only `awaiting` counts. A received claim is kept rather than deleted so the
 * user can see that a refund they chased actually arrived — but counting it
 * would mean the outstanding total never drops, which is the one thing the
 * number has to do.
 *
 * Added in whole cents. The float version of this drifts once a handful of
 * claims are open and renders an outstanding total ending in a stray fraction
 * of a cent — the class of bug the cents convention exists to stop.
 */
export function outstandingTotal(claims: Array<Pick<RefundClaim, 'expectedAmount' | 'status'>>): number {
  let total = 0;
  for (const claim of claims) {
    if (claim.status !== 'awaiting') continue;
    total += toCents(claim.expectedAmount);
  }
  return fromCents(total);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getRefundClaim(transactionId: string): Promise<RefundClaim | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<RefundClaim>('SELECT * FROM refund_claims WHERE id = ?', [
      refundClaimId(transactionId),
    ])) ?? null
  );
}

/**
 * Claims for a page of transactions in one query — the transactions list needs
 * to badge rows without a query per row. Same batching reasoning as
 * tagIdsForTransactions and attachSplits.
 */
export async function claimsForTransactions(transactionIds: string[]): Promise<Map<string, RefundClaim>> {
  const byTransaction = new Map<string, RefundClaim>();
  if (transactionIds.length === 0) return byTransaction;
  const db = await getDb();
  for (const chunk of chunkIds(transactionIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.getAllAsync<RefundClaim>(
      `SELECT * FROM refund_claims WHERE transactionId IN (${placeholders})`,
      chunk
    );
    for (const row of rows) byTransaction.set(row.transactionId, row);
  }
  return byTransaction;
}

/**
 * Every outstanding claim with its transaction, oldest first.
 *
 * Oldest first on purpose: the useful question is "what has been outstanding
 * longest?", because that is the one that has probably been forgotten. Newest
 * first would bury it under refunds the user still remembers requesting.
 *
 * Sweeps orphans first, for the reason spelled out on
 * sweepOrphanedRefundClaims — an orphan inflates the outstanding total, and
 * this is the read that total comes from.
 */
export async function listOutstandingClaims(): Promise<OutstandingClaim[]> {
  await sweepOrphanedRefundClaims();
  const db = await getDb();
  const rows = await db.getAllAsync<RefundClaim & Record<string, unknown>>(
    `SELECT rc.* FROM refund_claims rc
       JOIN transactions t ON t.id = rc.transactionId
      WHERE rc.status = 'awaiting'
      ORDER BY t.date ASC`
  );
  const out: OutstandingClaim[] = [];
  for (const claim of rows) {
    const transaction = await db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', [
      claim.transactionId,
    ]);
    if (transaction) out.push({ ...(claim as RefundClaim), transaction });
  }
  return out;
}

/** The headline number: how much the user is still owed. */
export async function outstandingRefundTotal(): Promise<number> {
  await sweepOrphanedRefundClaims();
  const db = await getDb();
  // Only claims whose transaction still exists — the JOIN is what makes this
  // agree with listOutstandingClaims rather than counting a row the sweep has
  // not reached yet.
  const rows = await db.getAllAsync<Pick<RefundClaim, 'expectedAmount' | 'status'>>(
    `SELECT rc.expectedAmount AS expectedAmount, rc.status AS status
       FROM refund_claims rc
       JOIN transactions t ON t.id = rc.transactionId`
  );
  return outstandingTotal(rows);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Marks a transaction as awaiting a refund, or updates the claim already on it.
 *
 * INSERT ... ON CONFLICT DO UPDATE rather than INSERT OR REPLACE: replacing the
 * row would reset createdAt, which is the only record of how long the money has
 * been outstanding — and "this has been owed since March" is most of why the
 * user is looking at the list.
 *
 * Re-opening a received claim clears resolvedAt, so a refund that was marked
 * received in error (or was reversed) does not keep a resolution date that
 * contradicts its own status.
 */
export async function setRefundClaim(
  transactionId: string,
  input: { expectedAmount: number; note?: string | null }
): Promise<void> {
  const db = await getDb();
  const id = refundClaimId(transactionId);
  // Stored through cents so a value typed as 12.345, or arrived at by a float
  // division upstream, cannot put a third decimal into the outstanding total.
  const expected = fromCents(Math.abs(toCents(input.expectedAmount)));
  const note = input.note?.trim() || null;

  await db.runAsync(
    `INSERT INTO refund_claims (id, transactionId, expectedAmount, status, note, createdAt, resolvedAt)
     VALUES (?, ?, ?, 'awaiting', ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       expectedAmount = excluded.expectedAmount,
       status = 'awaiting',
       note = excluded.note,
       resolvedAt = NULL`,
    [id, transactionId, expected, note, new Date().toISOString()]
  );
  // Read back and journal what actually landed: on the update branch createdAt
  // is the ORIGINAL one, not the value just bound, and the co-member must get
  // the row that is real here.
  await journalUpsert('refund_claims', 'id = ?', [id]);
}

/**
 * The refund arrived.
 *
 * Kept as a row rather than deleted, so "did that ever come back?" has an
 * answer months later. It stops counting toward the outstanding total the
 * moment its status changes — see outstandingTotal.
 */
export async function markRefundReceived(transactionId: string): Promise<void> {
  const db = await getDb();
  const id = refundClaimId(transactionId);
  await db.runAsync("UPDATE refund_claims SET status = 'received', resolvedAt = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
  await journalUpsert('refund_claims', 'id = ?', [id]);
}

/** Undoes the whole claim — "I was wrong, no refund is coming." */
export async function clearRefundClaim(transactionId: string): Promise<void> {
  const db = await getDb();
  const id = refundClaimId(transactionId);
  const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM refund_claims WHERE id = ?', [id]);
  if (!existing) return;
  await db.runAsync('DELETE FROM refund_claims WHERE id = ?', [id]);
  // Journaled only when a row was actually removed: pushing a tombstone for an
  // id that was never there would ask the co-member to delete a record they may
  // never have had. Same guard as bulkDeleteTransactions.
  await queueSyncMutation('DELETE', 'refund_claims', id, { id });
}

/**
 * Removes claims whose transaction is gone, and journals each one.
 *
 * The same backstop features/tags.ts documents at length. The delete paths that
 * can strand a claim are not reachable from here — lib/queries.ts
 * deleteTransaction, features/bulk-actions.ts, and a transaction tombstoned on
 * the other phone — and foreign keys are not enforced, so nothing cascades. An
 * orphaned claim keeps its amount in the outstanding total forever, with no
 * transaction left to open and no way for the user to clear it.
 */
export async function sweepOrphanedRefundClaims(): Promise<number> {
  const db = await getDb();
  const orphans = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM refund_claims WHERE transactionId NOT IN (SELECT id FROM transactions)'
  );
  if (orphans.length === 0) return 0;
  for (const orphan of orphans) {
    await db.runAsync('DELETE FROM refund_claims WHERE id = ?', [orphan.id]);
    await queueSyncMutation('DELETE', 'refund_claims', orphan.id, { id: orphan.id });
  }
  return orphans.length;
}

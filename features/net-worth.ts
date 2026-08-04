// ---------------------------------------------------------------------------
// features/net-worth.ts – Manual net-worth tracking: a short list of assets
// (what you own) and liabilities (what you owe), each holding one current
// balance the user updates by hand. Net worth is assets − liabilities, always
// derived at read time — no stored total that could drift from its rows.
//
// The `assets` and `liabilities` tables have existed in db-migrations since the
// intelligence-engine work but were read by nothing; this module is what
// finally uses them. Two columns were added for it via the self-healing
// PRAGMA pattern (see features/db-migrations.ts): `note` on both tables and
// `type` on liabilities.
//
// Sync contract: EVERY write in this file journals through queueSyncMutation,
// because a write that doesn't journal never reaches the other member of a
// shared household (see AGENTS.md rule 2). Both tables are in SYNCABLE_TABLES.
// Ids are plain uuid(): every row here is created by an explicit user action
// on one phone, never generated independently by both devices, so there is no
// natural key for two phones to converge on.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import { monthKeyFromDate, snapshotIdFor, type NetWorthSnapshot } from '../lib/net-worth-history';
import { queueSyncMutation } from './cloudkit-sync';

// ── Types ───────────────────────────────────────────────────────────────────

export type AssetType = 'cash' | 'investment' | 'property' | 'vehicle' | 'other';
export type LiabilityType = 'credit_card' | 'auto_loan' | 'mortgage' | 'student_loan' | 'other';

export type Asset = {
  id: string;
  name: string;
  /** Current value, always >= 0 as entered. */
  balance: number;
  type: AssetType;
  note: string | null;
  /** ISO timestamp of the last edit — drives the "as of" line. */
  lastUpdated: string;
};

export type Liability = {
  id: string;
  name: string;
  /** Amount owed, stored positive; the sign lives in the net-worth math. */
  balance: number;
  type: LiabilityType;
  note: string | null;
  lastUpdated: string;
};

/** Preset type choices, in display order. Stored value + what the row shows. */
export const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: 'cash', label: 'Cash / Savings' },
  { value: 'investment', label: 'Investment' },
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'other', label: 'Other' },
];

export const LIABILITY_TYPES: { value: LiabilityType; label: string }[] = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'auto_loan', label: 'Auto Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'student_loan', label: 'Student Loan' },
  { value: 'other', label: 'Other' },
];

/** A stored type the running build doesn't recognise still needs a label —
 * a co-member on a newer build may sync one in. */
export function typeLabel(kind: 'asset' | 'liability', value: string): string {
  const list = kind === 'asset' ? ASSET_TYPES : LIABILITY_TYPES;
  return list.find((t) => t.value === value)?.label ?? 'Other';
}

// ── Money helpers (same convention as features/funds.ts) ────────────────────

/** Money is cents — collapse float dust before it reaches the database. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listAssets(): Promise<Asset[]> {
  const db = await getDb();
  return db.getAllAsync<Asset>(
    'SELECT id, name, balance, type, note, lastUpdated FROM assets ORDER BY balance DESC, name ASC'
  );
}

export async function listLiabilities(): Promise<Liability[]> {
  const db = await getDb();
  return db.getAllAsync<Liability>(
    'SELECT id, name, balance, type, note, lastUpdated FROM liabilities ORDER BY balance DESC, name ASC'
  );
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type NetWorthEntryInput = {
  name: string;
  type: string;
  /** Entered positive on both sides; liabilities are subtracted in the math. */
  balance: number;
  note?: string | null;
};

type NetWorthTable = 'assets' | 'liabilities';

async function createEntry(table: NetWorthTable, input: NetWorthEntryInput): Promise<Asset | Liability> {
  const db = await getDb();
  const note = input.note?.trim();
  const entry = {
    id: uuid(),
    name: input.name.trim(),
    balance: Math.abs(fromCents(toCents(input.balance))),
    type: input.type,
    note: note ? note : null,
    lastUpdated: new Date().toISOString(),
  };
  await db.runAsync(
    `INSERT INTO ${table} (id, name, balance, type, note, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.name, entry.balance, entry.type, entry.note, entry.lastUpdated]
  );
  await queueSyncMutation('CREATE', table, entry.id, entry);
  await captureNetWorthSnapshot();
  return entry as Asset | Liability;
}

/**
 * Rewrites the whole row from the edit sheet's fields and stamps lastUpdated.
 *
 * The journaled payload is re-read from the database rather than assembled
 * from the patch, so what the co-member applies is exactly the row that landed
 * here — including any column a future migration adds.
 */
async function updateEntry(table: NetWorthTable, id: string, input: NetWorthEntryInput): Promise<void> {
  const db = await getDb();
  const note = input.note?.trim();
  await db.runAsync(
    `UPDATE ${table} SET name = ?, balance = ?, type = ?, note = ?, lastUpdated = ? WHERE id = ?`,
    [
      input.name.trim(),
      Math.abs(fromCents(toCents(input.balance))),
      input.type,
      note ? note : null,
      new Date().toISOString(),
      id,
    ]
  );
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (row) await queueSyncMutation('UPDATE', table, id, row);
  await captureNetWorthSnapshot();
}

async function deleteEntry(table: NetWorthTable, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
  // Nothing references these rows, so the delete orphans nothing — this one
  // journal entry is the whole story.
  await queueSyncMutation('DELETE', table, id, { id });
  // A delete moves net worth as surely as an edit does, so this month's
  // snapshot has to be re-taken. Deleting the last row records a real zero:
  // "nothing tracked" is the honest figure, not a gap in the line.
  await captureNetWorthSnapshot();
}

export function createAsset(input: NetWorthEntryInput): Promise<Asset> {
  return createEntry('assets', input) as Promise<Asset>;
}

export function updateAsset(id: string, input: NetWorthEntryInput): Promise<void> {
  return updateEntry('assets', id, input);
}

export function deleteAsset(id: string): Promise<void> {
  return deleteEntry('assets', id);
}

export function createLiability(input: NetWorthEntryInput): Promise<Liability> {
  return createEntry('liabilities', input) as Promise<Liability>;
}

export function updateLiability(id: string, input: NetWorthEntryInput): Promise<void> {
  return updateEntry('liabilities', id, input);
}

export function deleteLiability(id: string): Promise<void> {
  return deleteEntry('liabilities', id);
}

// ── Derived totals ──────────────────────────────────────────────────────────

export type NetWorthSummary = {
  assetTotal: number;
  liabilityTotal: number;
  /** assetTotal − liabilityTotal; negative is a real, displayable answer. */
  netWorth: number;
  /** Newest lastUpdated across both lists, or null when both are empty. */
  asOf: string | null;
};

/**
 * Pure math over the two lists, so the screen derives it on every render and
 * the fixture test (scripts/test-net-worth.mjs) can pin it without a database.
 *
 * Summed in cents for the same reason buildFundGrid does: a column of floats
 * otherwise lands on values like 124732.99999999999. Balances are taken as
 * magnitudes — a negative that slipped into storage (an old build, a synced
 * row) must not silently flip a liability into an asset.
 */
export function computeNetWorth(
  assets: { balance: number; lastUpdated: string }[],
  liabilities: { balance: number; lastUpdated: string }[]
): NetWorthSummary {
  let assetCents = 0;
  let liabilityCents = 0;
  let asOf: string | null = null;

  for (const a of assets) {
    assetCents += Math.abs(toCents(a.balance));
    if (!asOf || a.lastUpdated > asOf) asOf = a.lastUpdated;
  }
  for (const l of liabilities) {
    liabilityCents += Math.abs(toCents(l.balance));
    if (!asOf || l.lastUpdated > asOf) asOf = l.lastUpdated;
  }

  return {
    assetTotal: fromCents(assetCents),
    liabilityTotal: fromCents(liabilityCents),
    netWorth: fromCents(assetCents - liabilityCents),
    asOf,
  };
}

// ── History ─────────────────────────────────────────────────────────────────
//
// One row per calendar month in `net_worth_snapshots`, written on every balance
// edit and overwriting that month's row. The schema comment in
// features/db-migrations.ts carries the full month-vs-edit reasoning; the short
// version is that the edit sheet saves the whole row on every keystroke-save,
// so per-edit rows would grow the table without bound and record three points
// for one corrected typo.
//
// This is the only place net worth is ever written down. Everything else in
// this file derives it at read time, and that stays true: a snapshot is a
// record of what the derived figure WAS, never a total anything reads back.

/** A stored snapshot row. Shape matches lib/net-worth-history's input. */
export type NetWorthSnapshotRow = NetWorthSnapshot & { id: string };

export async function listNetWorthSnapshots(): Promise<NetWorthSnapshotRow[]> {
  const db = await getDb();
  return db.getAllAsync<NetWorthSnapshotRow>(
    'SELECT id, yearMonth, assetTotal, liabilityTotal, netWorth, capturedAt FROM net_worth_snapshots ORDER BY yearMonth ASC'
  );
}

/**
 * Record this month's net worth, replacing any figure already recorded for it.
 *
 * Called from every write path in this file rather than from the screen: a
 * balance edited from anywhere — a future quick-edit, a sync-triggered
 * recompute — has to land in the history, and a screen-level call would miss
 * it. Not called on launch or on focus, deliberately: a snapshot means "a
 * balance was confirmed in this month", and taking one just because the app was
 * opened would stamp a fresh date on numbers nobody has looked at since March.
 * Months with no edit are carried forward by buildNetWorthSeries and drawn as
 * unconfirmed, which is the truthful rendering of the same fact.
 *
 * Totals are recomputed from the tables rather than passed in, so the snapshot
 * can never disagree with the rows it summarises.
 *
 * KNOWN LIMIT, shared-household: the totals are whatever THIS device can see.
 * If a co-member added an asset that has not pulled down yet, this device's
 * snapshot for the month is short by that amount until the next edit re-takes
 * it. Correcting it would mean re-capturing after every pull, which lives in
 * cloudkit-sync's pull loop; it is not wrong so much as briefly stale, and the
 * balances themselves converge normally.
 */
export async function captureNetWorthSnapshot(now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const [assets, liabilities] = await Promise.all([listAssets(), listLiabilities()]);
  const summary = computeNetWorth(assets, liabilities);

  const yearMonth = monthKeyFromDate(now);
  const id = snapshotIdFor(yearMonth);
  const capturedAt = now.toISOString();

  // Conflict on yearMonth, the natural key. id is a pure function of it, so a
  // clash on one is always a clash on the other — naming the natural key is
  // what makes the intent ("one row per month") readable at the call site.
  await db.runAsync(
    `INSERT INTO net_worth_snapshots (id, yearMonth, assetTotal, liabilityTotal, netWorth, capturedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (yearMonth) DO UPDATE SET
       assetTotal = excluded.assetTotal,
       liabilityTotal = excluded.liabilityTotal,
       netWorth = excluded.netWorth,
       capturedAt = excluded.capturedAt`,
    [id, yearMonth, summary.assetTotal, summary.liabilityTotal, summary.netWorth, capturedAt]
  );

  // Journaled as UPDATE for the same reason journalUpsert does: the receiving
  // device may or may not already hold this month's row, and its pull applies
  // both actions as an INSERT OR REPLACE anyway. Re-read rather than reusing
  // the values above, so what the co-member applies is exactly the row that
  // landed here — including any column a later migration adds.
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM net_worth_snapshots WHERE id = ?',
    [id]
  );
  if (row) await queueSyncMutation('UPDATE', 'net_worth_snapshots', id, row);
}

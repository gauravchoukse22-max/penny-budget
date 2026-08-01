// ---------------------------------------------------------------------------
// features/funds.ts – The Funds grid: savings buckets (rows) × the accounts
// they're held at (columns), with a balance in each cell.
//
// Sync contract: EVERY write in this file journals through queueSyncMutation
// (or journalUpsert for the natural-key upsert), because a write that doesn't
// journal never reaches the other member of a shared household — it just
// silently stays on the phone that made it. See features/cloudkit-sync.ts.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import { journalUpsert } from '../lib/queries';
import { queueSyncMutation } from './cloudkit-sync';
import type { Fund, FundAccount, FundBalance } from './models';

// Seeded on first open so the grid already looks like the spreadsheet it
// replaces. Everything here is editable afterwards — nothing is special-cased.
export const DEFAULT_FUNDS: string[] = [
  'Emergency',
  'Savings',
  'Child / Education Savings',
  'Vacation',
  'Kanha',
  'House',
  'House Investment (IBKR)',
  'Invested (as of Jan 1st)',
  'Send to Family',
  'Amount for Tax returns',
  'Amount earning Interest for the month',
];

export const DEFAULT_FUND_ACCOUNTS: string[] = [
  'Wealthfront',
  'Apple Savings',
  'T bill + T Note',
  'Robinhood',
  'Cash (India)',
  'Disha Axis + IDFC',
];

/** Money is cents — collapse float dust before it reaches the database. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listFunds(): Promise<Fund[]> {
  const db = await getDb();
  return db.getAllAsync<Fund>('SELECT id, name, sortOrder, createdAt FROM funds ORDER BY sortOrder ASC, name ASC');
}

export async function listFundAccounts(): Promise<FundAccount[]> {
  const db = await getDb();
  return db.getAllAsync<FundAccount>(
    'SELECT id, name, sortOrder, createdAt FROM fund_accounts ORDER BY sortOrder ASC, name ASC'
  );
}

export async function listFundBalances(): Promise<FundBalance[]> {
  const db = await getDb();
  return db.getAllAsync<FundBalance>('SELECT * FROM fund_balances');
}

// ── Funds (rows) ────────────────────────────────────────────────────────────

export async function createFund(name: string): Promise<Fund> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM funds');
  const fund: Fund = {
    id: uuid(),
    name: name.trim(),
    sortOrder: (maxRow?.maxOrder ?? -1) + 1,
    createdAt: new Date().toISOString(),
  };
  // startingBalance is the vestigial column (see db-migrations) — left to its
  // default so the row still satisfies the schema.
  await db.runAsync('INSERT INTO funds (id, name, sortOrder, createdAt) VALUES (?, ?, ?, ?)', [
    fund.id,
    fund.name,
    fund.sortOrder,
    fund.createdAt,
  ]);
  await queueSyncMutation('CREATE', 'funds', fund.id, fund);
  return fund;
}

export async function renameFund(id: string, name: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<Fund>('SELECT id, name, sortOrder, createdAt FROM funds WHERE id = ?', [id]);
  if (!existing) return;
  const next: Fund = { ...existing, name: name.trim() };
  await db.runAsync('UPDATE funds SET name = ? WHERE id = ?', [next.name, id]);
  await queueSyncMutation('UPDATE', 'funds', id, next);
}

export async function deleteFund(id: string): Promise<void> {
  const db = await getDb();
  // FK enforcement is off in this app, so ON DELETE CASCADE never fires. Clear
  // the cells explicitly and journal each one — otherwise the co-member keeps
  // balances pointing at a fund that no longer exists and their grand total
  // stays permanently higher than ours.
  const cells = await db.getAllAsync<{ id: string }>('SELECT id FROM fund_balances WHERE fundId = ?', [id]);
  await db.runAsync('DELETE FROM fund_balances WHERE fundId = ?', [id]);
  await db.runAsync('DELETE FROM funds WHERE id = ?', [id]);
  for (const c of cells) await queueSyncMutation('DELETE', 'fund_balances', c.id, { id: c.id });
  await queueSyncMutation('DELETE', 'funds', id, { id });
}

// ── Accounts (columns) ──────────────────────────────────────────────────────

export async function createFundAccount(name: string): Promise<FundAccount> {
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM fund_accounts');
  const account: FundAccount = {
    id: uuid(),
    name: name.trim(),
    sortOrder: (maxRow?.maxOrder ?? -1) + 1,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync('INSERT INTO fund_accounts (id, name, sortOrder, createdAt) VALUES (?, ?, ?, ?)', [
    account.id,
    account.name,
    account.sortOrder,
    account.createdAt,
  ]);
  await queueSyncMutation('CREATE', 'fund_accounts', account.id, account);
  return account;
}

export async function renameFundAccount(id: string, name: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<FundAccount>('SELECT * FROM fund_accounts WHERE id = ?', [id]);
  if (!existing) return;
  const next: FundAccount = { ...existing, name: name.trim() };
  await db.runAsync('UPDATE fund_accounts SET name = ? WHERE id = ?', [next.name, id]);
  await queueSyncMutation('UPDATE', 'fund_accounts', id, next);
}

export async function deleteFundAccount(id: string): Promise<void> {
  const db = await getDb();
  const cells = await db.getAllAsync<{ id: string }>('SELECT id FROM fund_balances WHERE accountId = ?', [id]);
  await db.runAsync('DELETE FROM fund_balances WHERE accountId = ?', [id]);
  await db.runAsync('DELETE FROM fund_accounts WHERE id = ?', [id]);
  for (const c of cells) await queueSyncMutation('DELETE', 'fund_balances', c.id, { id: c.id });
  await queueSyncMutation('DELETE', 'fund_accounts', id, { id });
}

// ── Reordering ──────────────────────────────────────────────────────────────

type OrderableTable = 'funds' | 'fund_accounts';
type Orderable = { id: string; name: string; sortOrder: number; createdAt: string };

/**
 * Moves a row one position and renumbers the whole list from the new order.
 *
 * Deliberately not a two-row swap: positions collide whenever two devices each
 * append a row offline (both compute the same MAX+1), and swapping two equal
 * numbers looks to the user like the move silently did nothing. Renumbering
 * also self-heals any list that already drifted. Every row whose position
 * actually changes is journaled — pushing only the moved one would leave the
 * co-member with a different order than the one on screen here.
 */
async function moveInOrder(table: OrderableTable, id: string, delta: number): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<Orderable>(
    `SELECT id, name, sortOrder, createdAt FROM ${table} ORDER BY sortOrder ASC, name ASC`
  );
  const index = rows.findIndex((r) => r.id === id);
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;

  const reordered = [...rows];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved);

  for (let i = 0; i < reordered.length; i++) {
    const row = reordered[i];
    if (row.sortOrder === i) continue;
    await db.runAsync(`UPDATE ${table} SET sortOrder = ? WHERE id = ?`, [i, row.id]);
    await queueSyncMutation('UPDATE', table, row.id, { ...row, sortOrder: i });
  }
}

export function moveFund(id: string, delta: number): Promise<void> {
  return moveInOrder('funds', id, delta);
}

export function moveFundAccount(id: string, delta: number): Promise<void> {
  return moveInOrder('fund_accounts', id, delta);
}

// ── Balances (cells) ────────────────────────────────────────────────────────

/**
 * Writes a cell outright. Upserts on (fundId, accountId) so the same cell
 * edited on two phones converges on one row; journalUpsert then re-reads the
 * surviving row and journals ITS id, because the id we generated here may not
 * be the one that stayed.
 */
export async function setFundBalance(fundId: string, accountId: string, amount: number): Promise<void> {
  const db = await getDb();
  const value = fromCents(toCents(amount));
  await db.runAsync(
    `INSERT INTO fund_balances (id, fundId, accountId, amount, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (fundId, accountId) DO UPDATE SET amount = excluded.amount, updatedAt = excluded.updatedAt`,
    [uuid(), fundId, accountId, value, new Date().toISOString()]
  );
  await journalUpsert('fund_balances', 'fundId = ? AND accountId = ?', [fundId, accountId]);
}

// ── Totals ──────────────────────────────────────────────────────────────────

export type FundGrid = {
  /** `${fundId}:${accountId}` → amount, present only for cells the user has set. */
  cells: Map<string, number>;
  /** fundId → sum across every account. */
  rowTotals: Map<string, number>;
  /** accountId → sum down every fund. */
  columnTotals: Map<string, number>;
  grandTotal: number;
};

export function cellKey(fundId: string, accountId: string): string {
  return `${fundId}:${accountId}`;
}

/**
 * Derives every total from the raw rows. Pure and cheap, so the screen can call
 * it on each render instead of keeping totals in the database where a rename,
 * a delete, or a half-applied sync could leave them disagreeing with the cells.
 *
 * Summed in cents for the same reason sumAmount() is (lib/queries.ts): a column
 * of floats otherwise lands on values like 124732.99999999999.
 */
export function buildFundGrid(funds: Fund[], accounts: FundAccount[], balances: FundBalance[]): FundGrid {
  const fundIds = new Set(funds.map((f) => f.id));
  const accountIds = new Set(accounts.map((a) => a.id));

  const cells = new Map<string, number>();
  const rowCents = new Map<string, number>();
  const columnCents = new Map<string, number>();
  let grandCents = 0;

  for (const b of balances) {
    // Ignore cells orphaned by a delete that hasn't synced back yet, so the
    // grand total always equals what the visible grid adds up to.
    if (!fundIds.has(b.fundId) || !accountIds.has(b.accountId)) continue;
    const cents = toCents(b.amount);
    cells.set(cellKey(b.fundId, b.accountId), fromCents(cents));
    rowCents.set(b.fundId, (rowCents.get(b.fundId) ?? 0) + cents);
    columnCents.set(b.accountId, (columnCents.get(b.accountId) ?? 0) + cents);
    grandCents += cents;
  }

  const rowTotals = new Map(funds.map((f) => [f.id, fromCents(rowCents.get(f.id) ?? 0)]));
  const columnTotals = new Map(accounts.map((a) => [a.id, fromCents(columnCents.get(a.id) ?? 0)]));
  return { cells, rowTotals, columnTotals, grandTotal: fromCents(grandCents) };
}

// ── Seeding ─────────────────────────────────────────────────────────────────

/**
 * Fills in the default rows and columns the first time the Funds screen opens.
 *
 * Deliberately lazy rather than part of app startup: it keeps ~17 rows out of
 * the database (and out of the shared household) for anyone who never opens the
 * feature, and it means a second device in a household has usually already
 * pulled the real funds before it ever gets here — so it finds a non-empty
 * table and doesn't seed a duplicate set.
 *
 * Goes through the normal create* helpers so each seeded row is journaled.
 */
export async function seedDefaultFundsIfEmpty(): Promise<void> {
  const db = await getDb();
  const fundCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM funds');
  const accountCount = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM fund_accounts');
  if ((fundCount?.count ?? 0) > 0 || (accountCount?.count ?? 0) > 0) return;

  for (const name of DEFAULT_FUNDS) await createFund(name);
  for (const name of DEFAULT_FUND_ACCOUNTS) await createFundAccount(name);
}

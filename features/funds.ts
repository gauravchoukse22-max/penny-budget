// ---------------------------------------------------------------------------
// features/funds.ts – The Funds grid: savings buckets (rows) × the accounts
// they're held at (columns). Each cell is a LEDGER of contributions, not a
// balance: the balance is what those contributions add up to.
//
// That's the whole point of the feature. In the spreadsheet this replaces,
// every cell carried comments recording each deposit, so months later you
// could still answer "how much did we put into Child / Education in April?".
// Storing only the latest total answers "how much is in there now" and throws
// the rest away.
//
// Sync contract: EVERY write in this file journals through queueSyncMutation,
// because a write that doesn't journal never reaches the other member of a
// shared household — it just silently stays on the phone that made it. See
// features/cloudkit-sync.ts. The one deliberate exception is the migratedAt
// stamp on a legacy fund_balances row, which is device-local bookkeeping and
// documented at migrateFundBalancesToEntries.
//
// journalUpsert (lib/queries.ts) is no longer used here: entries are appended,
// never upserted on a natural key, so the id we write is always the id that
// survives.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';
import { queueSyncMutation } from './cloudkit-sync';
import type {
  Fund,
  FundAccount,
  FundAdjustMode,
  FundBalance,
  FundEntry,
  FundMonthSummary,
} from './models';

// The grid intentionally starts EMPTY — the user names their own rows and
// columns. It used to seed ~17 rows on first open, copied from the developer's
// personal spreadsheet ("Kanha", "Disha Axis + IDFC", …), which meant every
// fresh install shipped one household's finances as app content and pushed all
// of it into a shared household as journaled writes. The empty state on the
// Funds screen shows a SAMPLE grid instead, rendered from these labels without
// ever touching the database.
export const SAMPLE_FUNDS: string[] = ['Emergency', 'Vacation'];
export const SAMPLE_FUND_ACCOUNTS: string[] = ['Savings', 'Brokerage'];

/** The note the backfill puts on a converted legacy balance. */
export const OPENING_BALANCE_NOTE = 'Opening balance';

/** Money is cents — collapse float dust before it reaches the database. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

/** Local calendar date, not UTC — `new Date().toISOString()` rolls a day early
 * for anyone west of Greenwich, which would file an evening deposit under
 * tomorrow's month at the end of a month. */
function todayIsoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The YYYY-MM bucket an entry's date falls in. */
function entryYearMonth(entry: FundEntry): string {
  return entry.date.slice(0, 7);
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

/**
 * Every contribution, newest first.
 *
 * Ordered by date then createdAt: two entries dated the same day still need a
 * stable order, and the one typed second is the later one.
 */
export async function listFundEntries(): Promise<FundEntry[]> {
  const db = await getDb();
  return db.getAllAsync<FundEntry>('SELECT * FROM fund_entries ORDER BY date DESC, createdAt DESC');
}

export async function listFundEntriesForFund(fundId: string): Promise<FundEntry[]> {
  const db = await getDb();
  return db.getAllAsync<FundEntry>(
    'SELECT * FROM fund_entries WHERE fundId = ? ORDER BY date DESC, createdAt DESC',
    [fundId]
  );
}

/** What one cell currently holds, straight from the ledger. */
export async function fundCellBalance(fundId: string, accountId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount) as total FROM fund_entries WHERE fundId = ? AND accountId = ?',
    [fundId, accountId]
  );
  return fromCents(toCents(row?.total ?? 0));
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
  await deleteFundGridOwner('funds', 'fundId', id);
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
  await deleteFundGridOwner('fund_accounts', 'accountId', id);
}

/**
 * Deletes a fund (or an account) together with everything hanging off it.
 *
 * FK enforcement is off in this app, so ON DELETE CASCADE never fires. Every
 * orphaned row is removed AND journaled individually — journaling only the
 * fund would leave the co-member holding entries that point at something that
 * no longer exists, and their grand total would stay permanently higher than
 * ours with nothing on screen to explain the difference.
 *
 * Legacy fund_balances rows are swept in the same pass: a device that upgraded
 * before its balances were ever backfilled would otherwise resurrect a deleted
 * fund's money the next time the backfill ran.
 *
 * Savings goals pointing here are unlinked in the same pass. A goal left
 * pointing at a deleted fund would look linked on the Budget screen yet file
 * nothing on the next tick — a silent no-op is worse than an obvious "not
 * linked", and the co-member has to be told or their goal keeps the dead link.
 */
async function deleteFundGridOwner(
  table: 'funds' | 'fund_accounts',
  foreignKey: 'fundId' | 'accountId',
  id: string
): Promise<void> {
  const db = await getDb();
  const linkColumn = foreignKey === 'fundId' ? 'targetFundId' : 'targetAccountId';
  const entries = await db.getAllAsync<{ id: string }>(`SELECT id FROM fund_entries WHERE ${foreignKey} = ?`, [id]);
  const balances = await db.getAllAsync<{ id: string }>(`SELECT id FROM fund_balances WHERE ${foreignKey} = ?`, [id]);
  const linkedGoals = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM savings_goals WHERE ${linkColumn} = ?`,
    [id]
  );

  await db.runAsync(`DELETE FROM fund_entries WHERE ${foreignKey} = ?`, [id]);
  await db.runAsync(`DELETE FROM fund_balances WHERE ${foreignKey} = ?`, [id]);
  await db.runAsync(`UPDATE savings_goals SET ${linkColumn} = NULL WHERE ${linkColumn} = ?`, [id]);
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);

  for (const e of entries) await queueSyncMutation('DELETE', 'fund_entries', e.id, { id: e.id });
  for (const b of balances) await queueSyncMutation('DELETE', 'fund_balances', b.id, { id: b.id });
  // Re-read each goal so the journaled payload is exactly the row that landed,
  // cleared link included.
  for (const g of linkedGoals) {
    const row = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM savings_goals WHERE id = ?', [g.id]);
    if (row) await queueSyncMutation('UPDATE', 'savings_goals', g.id, row);
  }
  await queueSyncMutation('DELETE', table, id, { id });
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

// ── Entries (the ledger) ────────────────────────────────────────────────────

export type FundEntryInput = {
  fundId: string;
  accountId: string;
  /** Signed: money in positive, money out negative. */
  amount: number;
  /** YYYY-MM-DD. Defaults to today. */
  date?: string;
  note?: string | null;
};

/**
 * Records one contribution. Append-only — nothing existing is touched.
 *
 * A plain INSERT with a fresh id rather than the upsert the old balance used:
 * two people paying into the same fund in the same week are two facts, and if
 * both phones are offline both entries must survive and add up. An upsert on
 * (fundId, accountId) would have one silently replace the other.
 */
export async function addFundEntry(input: FundEntryInput): Promise<FundEntry> {
  const db = await getDb();
  const note = input.note?.trim();
  const entry: FundEntry = {
    id: uuid(),
    fundId: input.fundId,
    accountId: input.accountId,
    amount: fromCents(toCents(input.amount)),
    date: input.date ?? todayIsoDate(),
    note: note ? note : null,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO fund_entries (id, fundId, accountId, amount, date, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [entry.id, entry.fundId, entry.accountId, entry.amount, entry.date, entry.note, entry.createdAt]
  );
  await queueSyncMutation('CREATE', 'fund_entries', entry.id, entry);
  return entry;
}

export async function deleteFundEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM fund_entries WHERE id = ?', [id]);
  await queueSyncMutation('DELETE', 'fund_entries', id, { id });
}

export type FundCellAdjustment = {
  fundId: string;
  accountId: string;
  mode: FundAdjustMode;
  /** Always positive as typed — `mode` carries the sign. */
  amount: number;
  date?: string;
  note?: string | null;
};

/**
 * Turns what the cell sheet collected into a single signed entry.
 *
 * "Set to" is the interesting one: rather than rewriting the balance it files
 * the DIFFERENCE as its own entry, so correcting a total still leaves the
 * earlier deposits — and the reason for the correction — in the history. The
 * difference is measured against the ledger as it is right now, not the total
 * the sheet rendered, so a contribution that synced in while the sheet was
 * open isn't quietly erased.
 *
 * Returns null when the adjustment is a no-op; an entry of 0 would be noise.
 */
export async function adjustFundCell(adjustment: FundCellAdjustment): Promise<FundEntry | null> {
  const { fundId, accountId, mode, amount } = adjustment;
  const magnitude = Math.abs(fromCents(toCents(amount)));

  let delta: number;
  if (mode === 'add') delta = magnitude;
  else if (mode === 'subtract') delta = -magnitude;
  else {
    const current = await fundCellBalance(fundId, accountId);
    delta = fromCents(toCents(magnitude) - toCents(current));
  }

  if (toCents(delta) === 0) return null;
  return addFundEntry({ fundId, accountId, amount: delta, date: adjustment.date, note: adjustment.note });
}

// ── Savings-goal auto-contributions ─────────────────────────────────────────
//
// A savings goal can be linked to one cell of this grid. Ticking that goal's
// "transferred this month" box then files the contribution here instead of the
// user typing the same number twice — see reconcileSavingsGoalEntries.

/** Marks a fund entry as one the savings-goal checklist owns, not one the user typed. */
export const SAVINGS_GOAL_ENTRY_PREFIX = 'goal-';

/**
 * The id an auto-filed contribution always gets, derived from the goal and the
 * month rather than uuid().
 *
 * Same reasoning as the recurring-transaction poster: in a shared household
 * both phones run this independently, so a random id would file the same
 * month's saving once per phone and sync them in as two contributions. Keying
 * on (goal, month) makes them the same record, and the pull's INSERT OR REPLACE
 * upsert collapses them into one.
 */
export function savingsGoalEntryId(goalId: string, yearMonth: string): string {
  return `${SAVINGS_GOAL_ENTRY_PREFIX}${goalId}-${yearMonth}`;
}

/** True for a contribution filed by the checklist rather than typed by hand. */
export function isSavingsGoalEntry(entry: { id: string }): boolean {
  return entry.id.startsWith(SAVINGS_GOAL_ENTRY_PREFIX);
}

// Deliberately NOT lib/format's formatMonthLabel, which follows the device
// locale. This string is STORED data that both phones write to the same record:
// if one device is en-US and the other isn't, the note would flip back and
// forth on every sync. A fixed table keeps the record identical everywhere.
const ENTRY_NOTE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "July 2026 savings" — names the month the money was budgeted for. */
export function savingsGoalEntryNote(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const name = ENTRY_NOTE_MONTHS[Number(month) - 1];
  return name ? `${name} ${year} savings` : `${yearMonth} savings`;
}

/** The grid cell a goal pays into. Null on either half means "not linked". */
export type SavingsGoalFundTarget = { fundId: string | null; accountId: string | null };

/** One month the goal's transfer is ticked for, and what it was budgeted at. */
export type SavingsGoalTransferredMonth = { yearMonth: string; amount: number };

/**
 * Makes the goal's contributions in the grid match its ticked months exactly.
 *
 * Declarative rather than "add one / remove one" on purpose: the caller states
 * which months are ticked and this files precisely those, so tick, untick,
 * re-tick, an amount correction, a re-link and an unlink are all the same code
 * path and none of them can leave a stray or duplicated entry behind. Passing
 * an empty target (or no months) is therefore also how a goal's entries get
 * swept when it is unlinked or deleted.
 *
 * Rows that already match are skipped rather than rewritten — re-journaling an
 * identical row on every tick would fill the outbox with no-ops, and it would
 * ping-pong between two phones that each keep "correcting" the other.
 *
 * Entries are dated the 1st of their month, not today: the date has to be
 * identical on both devices or the last one to sync would silently move the
 * entry, and the 1st is what puts it in the right bucket in the fund's monthly
 * history regardless of when the box was actually ticked.
 */
export async function reconcileSavingsGoalEntries(
  goalId: string,
  target: SavingsGoalFundTarget,
  months: SavingsGoalTransferredMonth[]
): Promise<void> {
  const db = await getDb();

  const desired = new Map<string, FundEntry>();
  if (target.fundId && target.accountId) {
    for (const month of months) {
      const amount = fromCents(toCents(month.amount));
      // A goal budgeted at zero has no money to file; an entry of 0 is noise.
      if (toCents(amount) === 0) continue;
      const id = savingsGoalEntryId(goalId, month.yearMonth);
      desired.set(id, {
        id,
        fundId: target.fundId,
        accountId: target.accountId,
        amount,
        date: `${month.yearMonth}-01`,
        note: savingsGoalEntryNote(month.yearMonth),
        createdAt: '', // replaced below — an existing row keeps its own
      });
    }
  }

  // The id prefix is the whole index: goalId is a uuid (hex + hyphens), so it
  // can't contain a LIKE wildcard and this matches this goal's entries only.
  const existing = await db.getAllAsync<FundEntry>('SELECT * FROM fund_entries WHERE id LIKE ?', [
    `${SAVINGS_GOAL_ENTRY_PREFIX}${goalId}-%`,
  ]);

  for (const row of existing) {
    const want = desired.get(row.id);
    if (!want) {
      await db.runAsync('DELETE FROM fund_entries WHERE id = ?', [row.id]);
      await queueSyncMutation('DELETE', 'fund_entries', row.id, { id: row.id });
      continue;
    }
    // Keep the original createdAt so re-ticking a box doesn't reshuffle the
    // order of entries filed on the same day.
    want.createdAt = row.createdAt;
    const unchanged =
      row.fundId === want.fundId &&
      row.accountId === want.accountId &&
      toCents(row.amount) === toCents(want.amount) &&
      row.date === want.date &&
      row.note === want.note;
    if (unchanged) desired.delete(row.id);
  }

  for (const entry of desired.values()) {
    if (!entry.createdAt) entry.createdAt = new Date().toISOString();
    await db.runAsync(
      `INSERT OR REPLACE INTO fund_entries (id, fundId, accountId, amount, date, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.fundId, entry.accountId, entry.amount, entry.date, entry.note, entry.createdAt]
    );
    await queueSyncMutation('CREATE', 'fund_entries', entry.id, entry);
  }
}

// ── Totals ──────────────────────────────────────────────────────────────────

export type FundGrid = {
  /** `${fundId}:${accountId}` → balance, present only for cells with entries. */
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
 * Derives every total from the raw entries. Pure and cheap, so the screen can
 * call it on each render instead of keeping totals in the database where a
 * rename, a delete, or a half-applied sync could leave them disagreeing with
 * the ledger.
 *
 * Summed in cents for the same reason sumAmount() is (lib/queries.ts): a column
 * of floats otherwise lands on values like 124732.99999999999.
 */
export function buildFundGrid(funds: Fund[], accounts: FundAccount[], entries: FundEntry[]): FundGrid {
  const fundIds = new Set(funds.map((f) => f.id));
  const accountIds = new Set(accounts.map((a) => a.id));

  const cellCents = new Map<string, number>();
  const rowCents = new Map<string, number>();
  const columnCents = new Map<string, number>();
  let grandCents = 0;

  for (const e of entries) {
    // Ignore entries orphaned by a delete that hasn't synced back yet, so the
    // grand total always equals what the visible grid adds up to.
    if (!fundIds.has(e.fundId) || !accountIds.has(e.accountId)) continue;
    const key = cellKey(e.fundId, e.accountId);
    const cents = toCents(e.amount);
    cellCents.set(key, (cellCents.get(key) ?? 0) + cents);
    rowCents.set(e.fundId, (rowCents.get(e.fundId) ?? 0) + cents);
    columnCents.set(e.accountId, (columnCents.get(e.accountId) ?? 0) + cents);
    grandCents += cents;
  }

  const cells = new Map([...cellCents].map(([key, cents]) => [key, fromCents(cents)]));
  const rowTotals = new Map(funds.map((f) => [f.id, fromCents(rowCents.get(f.id) ?? 0)]));
  const columnTotals = new Map(accounts.map((a) => [a.id, fromCents(columnCents.get(a.id) ?? 0)]));
  return { cells, rowTotals, columnTotals, grandTotal: fromCents(grandCents) };
}

/**
 * Groups a fund's entries into months, newest month first — the "how much did
 * we add in April?" view.
 *
 * `added` and `removed` are reported separately rather than only netted: a
 * month where 2,000 went in and 1,800 came straight back out is a different
 * month from one where 200 went in, and a single net figure hides that.
 * `balanceAfter` runs oldest→newest so each month also answers "what was in
 * there at the time".
 */
export function buildFundMonthlyHistory(entries: FundEntry[]): FundMonthSummary[] {
  const byMonth = new Map<string, FundEntry[]>();
  for (const e of entries) {
    const ym = entryYearMonth(e);
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(e);
    else byMonth.set(ym, [e]);
  }

  const oldestFirst = [...byMonth.keys()].sort();
  let runningCents = 0;
  const summaries: FundMonthSummary[] = [];

  for (const yearMonth of oldestFirst) {
    const monthEntries = (byMonth.get(yearMonth) ?? [])
      .slice()
      .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
    let addedCents = 0;
    let removedCents = 0;
    for (const e of monthEntries) {
      const cents = toCents(e.amount);
      if (cents >= 0) addedCents += cents;
      else removedCents -= cents;
    }
    runningCents += addedCents - removedCents;
    summaries.push({
      yearMonth,
      added: fromCents(addedCents),
      removed: fromCents(removedCents),
      net: fromCents(addedCents - removedCents),
      balanceAfter: fromCents(runningCents),
      entries: monthEntries,
    });
  }

  return summaries.reverse();
}

// ── Legacy balance → ledger backfill ────────────────────────────────────────

/**
 * Turns each pre-ledger fund_balances row into an opening entry.
 *
 * Safe to run on a phone that already has money in the grid, and safe to run
 * repeatedly, because of three things:
 *
 *  1. The entry reuses the balance row's OWN id. That makes it deterministic:
 *     both phones in a household convert the same synced balance into the same
 *     record, so when the two meet they converge on one opening entry instead
 *     of each contributing their own and doubling the fund.
 *  2. The source row is stamped `migratedAt`, so a cell whose entries were all
 *     later deleted on purpose doesn't have its opening balance resurrected on
 *     the next launch. That stamp is local-only and never journaled — a
 *     co-member on the old build has no such column and applying a payload
 *     carrying it would throw inside their pull transaction.
 *  3. A cell that already has entries is skipped outright, which backstops (2)
 *     if a legacy device re-pushes the balance row and blanks the stamp.
 *
 * Zero balances are skipped: a cell worth nothing has no history to preserve,
 * and an opening entry of 0 is just noise in the list.
 *
 * Returns how many entries it created, for logging/tests.
 */
export async function migrateFundBalancesToEntries(): Promise<number> {
  const db = await getDb();
  const balances = await db.getAllAsync<FundBalance>(
    'SELECT id, fundId, accountId, amount, updatedAt FROM fund_balances WHERE migratedAt IS NULL'
  );
  if (balances.length === 0) return 0;

  let created = 0;
  for (const balance of balances) {
    const stampedAt = new Date().toISOString();

    if (toCents(balance.amount) !== 0) {
      const existing = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM fund_entries WHERE fundId = ? AND accountId = ?',
        [balance.fundId, balance.accountId]
      );
      if ((existing?.count ?? 0) === 0) {
        // Dated when the balance was last touched, not today, so the opening
        // money lands in the month it actually belonged to instead of piling
        // this month's history up with everything that came before it.
        const date = /^\d{4}-\d{2}-\d{2}/.test(balance.updatedAt ?? '')
          ? balance.updatedAt.slice(0, 10)
          : todayIsoDate();
        const entry: FundEntry = {
          id: balance.id,
          fundId: balance.fundId,
          accountId: balance.accountId,
          amount: fromCents(toCents(balance.amount)),
          date,
          note: OPENING_BALANCE_NOTE,
          createdAt: balance.updatedAt ?? stampedAt,
        };
        await db.runAsync(
          `INSERT OR IGNORE INTO fund_entries (id, fundId, accountId, amount, date, note, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.fundId, entry.accountId, entry.amount, entry.date, entry.note, entry.createdAt]
        );
        await queueSyncMutation('CREATE', 'fund_entries', entry.id, entry);
        created++;
      }
    }

    // The legacy row itself is left in place, not deleted: removing it would
    // journal a DELETE that a co-member still on the old build would apply,
    // wiping the balance their grid is still reading from.
    await db.runAsync('UPDATE fund_balances SET migratedAt = ? WHERE id = ?', [stampedAt, balance.id]);
  }
  return created;
}

/**
 * Everything the grid needs, with the legacy backfill already applied.
 *
 * Single entry point on purpose: the backfill has to have run before any
 * total is shown, and every screen that reads a fund total (the grid, the
 * Insights card) going through here is what stops one of them rendering a
 * pre-upgrade user's savings as zero.
 */
export async function loadFundGrid(): Promise<{
  funds: Fund[];
  accounts: FundAccount[];
  entries: FundEntry[];
  grid: FundGrid;
}> {
  await migrateFundBalancesToEntries();
  const [funds, accounts, entries] = await Promise.all([listFunds(), listFundAccounts(), listFundEntries()]);
  return { funds, accounts, entries, grid: buildFundGrid(funds, accounts, entries) };
}

// ── Seeding ─────────────────────────────────────────────────────────────────


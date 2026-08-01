// ---------------------------------------------------------------------------
// features/db-migrations.ts – Self-healing database migrations for all tables
// introduced by the intelligence engine.
//
// Every migration is idempotent:
//   • New tables use CREATE TABLE IF NOT EXISTS.
//   • Existing tables are patched via ALTER TABLE only after a PRAGMA
//     table_info check confirms the column is absent.
//
// Takes an open handle rather than calling getDb() itself, because lib/db.ts
// runs this from INSIDE openAndMigrate: getDb() there would await the very
// promise that hasn't resolved yet and deadlock the whole app on first launch.
// That also keeps the dependency one-way (lib/db → features/db-migrations),
// so there is no import cycle.
// ---------------------------------------------------------------------------

import type * as SQLite from 'expo-sqlite';

// ---- helpers ---------------------------------------------------------------

/** Returns the set of column names for a given table. */
async function columnNames(
  db: SQLite.SQLiteDatabase,
  table: string,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  return new Set(rows.map((r) => r.name));
}

/** Adds a column to `table` only if it doesn't already exist. */
async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const cols = await columnNames(db, table);
  if (!cols.has(column)) {
    await db.execAsync(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`,
    );
  }
}

// ---- public API ------------------------------------------------------------

/**
 * Run all feature-level database migrations against an open handle.
 *
 * Called from lib/db.ts's migrateFeatureTables on every launch, after the core
 * tables exist. Every statement is safe to re-run.
 */
export async function applyFeatureMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // -- 1. New tables ---------------------------------------------------------

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id            TEXT PRIMARY KEY NOT NULL,
      note          TEXT NOT NULL,
      amount        REAL NOT NULL,
      categoryId    TEXT,
      cardId        TEXT NOT NULL,
      dayOfMonth    INTEGER NOT NULL,
      nextPostDate  TEXT NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (cardId)     REFERENCES cards(id)      ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category_rules (
      id          TEXT PRIMARY KEY NOT NULL,
      keyword     TEXT NOT NULL COLLATE NOCASE,
      categoryId  TEXT NOT NULL,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- A savings bucket (row in the Funds grid). startingBalance is vestigial
    -- from an earlier design that never shipped: nothing reads it, and dropping
    -- a column in SQLite means rebuilding the table, so it stays as dead weight
    -- with a default. Real money lives in fund_entries.
    CREATE TABLE IF NOT EXISTS funds (
      id              TEXT PRIMARY KEY NOT NULL,
      name            TEXT NOT NULL,
      startingBalance REAL NOT NULL DEFAULT 0,
      createdAt       TEXT NOT NULL
    );

    -- An institution the funds are held at (column in the Funds grid).
    CREATE TABLE IF NOT EXISTS fund_accounts (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      sortOrder   INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL
    );

    -- LEGACY. Each cell used to store one running balance here, which threw
    -- away the answer to "how much did we add to Child savings in April?".
    -- fund_entries replaced it. The table survives for two reasons: it is the
    -- source the one-time backfill reads (features/funds.ts
    -- migrateFundBalancesToEntries), and a household member still on the old
    -- build keeps pushing rows for it — with the table gone, applying their
    -- record would throw inside the pull transaction and stall sync entirely.
    CREATE TABLE IF NOT EXISTS fund_balances (
      id          TEXT PRIMARY KEY NOT NULL,
      fundId      TEXT NOT NULL,
      accountId   TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      updatedAt   TEXT NOT NULL,
      UNIQUE (fundId, accountId)
    );

    -- One contribution to one cell of the grid: "we put 500 into Child savings
    -- at Wealthfront in April, because bonus". A cell's balance is SUM(amount)
    -- of its entries; amount is signed, so a withdrawal is just a negative one
    -- and history stays a complete record rather than a corrected total.
    --
    -- No UNIQUE natural key on purpose (unlike fund_balances): two entries on
    -- the same cell, same day, same amount are two real contributions, and
    -- append-only rows are also what lets two phones edit the same cell
    -- offline and end up with the correct SUM instead of one overwriting the
    -- other's total.
    CREATE TABLE IF NOT EXISTS fund_entries (
      id          TEXT PRIMARY KEY NOT NULL,
      fundId      TEXT NOT NULL,
      accountId   TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      date        TEXT NOT NULL,
      note        TEXT,
      createdAt   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fund_entries_cell ON fund_entries(fundId, accountId);
    CREATE INDEX IF NOT EXISTS idx_fund_entries_date ON fund_entries(date);

    CREATE TABLE IF NOT EXISTS assets (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      balance     REAL NOT NULL DEFAULT 0,
      type        TEXT NOT NULL DEFAULT 'cash',
      lastUpdated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS liabilities (
      id              TEXT PRIMARY KEY NOT NULL,
      name            TEXT NOT NULL,
      balance         REAL NOT NULL DEFAULT 0,
      interestRate    REAL,
      minimumPayment  REAL,
      lastUpdated     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streaks (
      id              TEXT PRIMARY KEY NOT NULL,
      type            TEXT NOT NULL,
      currentStreak   INTEGER NOT NULL DEFAULT 0,
      longestStreak   INTEGER NOT NULL DEFAULT 0,
      lastActiveDate  TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id          TEXT PRIMARY KEY NOT NULL,
      action      TEXT NOT NULL,
      tableName   TEXT NOT NULL,
      recordId    TEXT NOT NULL,
      payload     TEXT NOT NULL,
      createdAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      id          TEXT PRIMARY KEY NOT NULL,
      syncToken   TEXT
    );
  `);

  // -- 2. Self-heal columns on existing tables --------------------------------

  // `funds` predates the Funds grid, so installs that already ran the old
  // CREATE lack sortOrder — CREATE TABLE IF NOT EXISTS would silently skip it.
  await addColumnIfMissing(db, 'funds', 'sortOrder', 'INTEGER NOT NULL DEFAULT 0');
  // Stamped once a legacy balance has become an opening entry. Device-local
  // bookkeeping, never journaled: a co-member on the old build has no such
  // column, and their INSERT OR REPLACE of a payload carrying it would throw.
  await addColumnIfMissing(db, 'fund_balances', 'migratedAt', 'TEXT');
  await addColumnIfMissing(db, 'savings_goals', 'targetFundId', 'TEXT');
  await addColumnIfMissing(
    db,
    'categories',
    'rolloverEnabled',
    'INTEGER DEFAULT 0',
  );
  await addColumnIfMissing(db, 'transactions', 'receiptUri', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'memo', 'TEXT');
}

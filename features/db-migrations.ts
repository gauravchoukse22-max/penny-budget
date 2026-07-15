// ---------------------------------------------------------------------------
// features/db-migrations.ts – Self-healing database migrations for all tables
// introduced by the intelligence engine.
//
// Every migration is idempotent:
//   • New tables use CREATE TABLE IF NOT EXISTS.
//   • Existing tables are patched via ALTER TABLE only after a PRAGMA
//     table_info check confirms the column is absent.
// ---------------------------------------------------------------------------

import { getDb } from '../lib/db';

// ---- helpers ---------------------------------------------------------------

/** Returns the set of column names for a given table. */
async function columnNames(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  return new Set(rows.map((r) => r.name));
}

/** Adds a column to `table` only if it doesn't already exist. */
async function addColumnIfMissing(
  db: Awaited<ReturnType<typeof getDb>>,
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
 * Run all feature-level database migrations.
 *
 * Call this once at app startup (after the core `getDb()` migrations have
 * already executed).  Every statement is safe to re-run on subsequent launches.
 */
export async function runFeatureMigrations(): Promise<void> {
  const db = await getDb();

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

    CREATE TABLE IF NOT EXISTS funds (
      id              TEXT PRIMARY KEY NOT NULL,
      name            TEXT NOT NULL,
      startingBalance REAL NOT NULL DEFAULT 0,
      createdAt       TEXT NOT NULL
    );

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

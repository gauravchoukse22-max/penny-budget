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
// lib/models.ts is types + plain constants with zero imports of its own, so
// this stays as dependency-free as the header above promises.
import {
  CASH_CARD_COLOR,
  CASH_CARD_ID,
  CASH_CARD_NAME,
  CASH_CARD_SORT_ORDER,
} from '../lib/models';

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

    -- Net worth history: one row per calendar MONTH, holding the totals as of
    -- the last balance edit in that month (features/net-worth.ts
    -- captureNetWorthSnapshot, lib/net-worth-history.ts).
    --
    -- Per-month rather than per-edit. Per-edit was tried on paper first and
    -- rejected twice over: the edit sheet rewrites the whole row on every
    -- Save, so correcting a typo three times would plant three points on the
    -- same afternoon, and the table would then grow without bound on a feature
    -- whose entire input is a number typed off a monthly statement. Chart
    -- resolution loses nothing real — the balances themselves only change when
    -- a statement arrives. What is lost is the intra-month audit trail, which
    -- nothing asks for: within a month the later edit is a correction of the
    -- earlier one, not a second fact.
    --
    -- id is 'nw-<yearMonth>', derived from the period and never uuid(): both
    -- phones in a household write August the moment either edits a balance, and
    -- random ids would make that two rows and two points (AGENTS.md rule 2).
    -- yearMonth carries the UNIQUE constraint as the natural key; because the
    -- id is a pure function of it, the two keys can never disagree.
    CREATE TABLE IF NOT EXISTS net_worth_snapshots (
      id              TEXT PRIMARY KEY NOT NULL,
      yearMonth       TEXT NOT NULL UNIQUE,
      assetTotal      REAL NOT NULL DEFAULT 0,
      liabilityTotal  REAL NOT NULL DEFAULT 0,
      netWorth        REAL NOT NULL DEFAULT 0,
      capturedAt      TEXT NOT NULL
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

  // Settings that describe the shared BUDGET rather than the phone
  // (features/shared-settings.ts). app_settings deliberately never syncs — it
  // also holds the biometric lock and the household id — so a household member
  // reads these from here instead, and both phones show the same currency
  // symbol on the same numbers.
  //
  // Key/value rows rather than a column per setting: the next shared setting is
  // then a new KEY, not an ALTER TABLE, so a member on an older build stores an
  // unrecognised row and ignores it instead of throwing on an unknown column
  // mid-pull — the hazard documented on savings_goals.targetFundId below.
  //
  // id is 'shs-<householdId>-<key>', derived and never uuid(): both phones write
  // the currency the moment either changes it, and random ids would make that
  // two rows with an arbitrary winner (AGENTS.md rule 2). The UNIQUE natural key
  // is (householdId, settingKey); because the id is a pure function of it, the
  // two can never disagree.
  //
  // settingKey/settingValue rather than key/value: SQLite does accept KEY as an
  // identifier, but the sync pull builds `INSERT OR REPLACE INTO shared_settings
  // (<columns from the payload>)` unquoted, and a column name that is also a
  // keyword is not worth the risk on a path that fails inside a transaction.
  //
  // Appended as its own statement rather than inside the block above so this
  // stays a pure addition to the migration list.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS shared_settings (
      id            TEXT PRIMARY KEY NOT NULL,
      householdId   TEXT NOT NULL,
      settingKey    TEXT NOT NULL,
      settingValue  TEXT NOT NULL,
      updatedAt     TEXT NOT NULL,
      UNIQUE (householdId, settingKey)
    );
  `);

  // Tags (features/tags.ts, lib/tags.ts) — a cross-category label on a
  // transaction. A category says what KIND of spending something is and a
  // transaction gets exactly one; a tag says what it was FOR, and that cuts
  // across categories — a holiday is flights, dinners and a pharmacy run.
  //
  // Two tables because it is a many-to-many: one purchase can be both
  // "vacation" and "reimbursable", and one tag spans thousands of purchases.
  // A comma-joined string column on transactions was the obvious cheaper
  // option and is rejected outright — renaming or deleting a tag would mean
  // rewriting every transaction row that mentions it, and "vacation" would
  // match "vacation-2025" on any query that could be written against it.
  //
  // NO foreign keys and NO ON DELETE CASCADE, deliberately: FK enforcement is
  // off in this database, so a cascade here would read as protection while
  // doing nothing. features/tags.ts deletes the join rows by hand on both
  // sides and journals each one (AGENTS.md rule 2).
  //
  // Both ids are DERIVED, never uuid() — see the long note in lib/tags.ts.
  // tags.id is `tag-<slug>-<hash>` of the name, so both phones typing
  // "vacation" write one row; transaction_tags.id is
  // `txtag-<transactionId>-<tagId>`, so both phones tagging the same purchase
  // write one join row instead of two and the tag total is not doubled.
  // Neither table carries a UNIQUE natural key: the derived primary key IS the
  // natural key, and a second UNIQUE constraint could only ever disagree with
  // it — which on the pull path throws inside a transaction and stalls sync.
  //
  // nameKey is stored rather than derived at read time so the picker can find
  // an existing tag case-insensitively without pulling every row into JS.
  //
  // Refund claims (features/refunds.ts) — "I expect this money back".
  //
  // Its OWN TABLE rather than columns on transactions, for three reasons and
  // the first is decisive:
  //  1. ROLLOUT. A new column on `transactions` rides along in every
  //     transaction sync payload, and a household member on a build without
  //     the migration throws applying it — stalling their entire pull, the
  //     hazard documented on savings_goals.targetFundId below. A new TABLE is
  //     simply absent from their SYNCABLE_TABLES, so their pull SKIPS these
  //     records instead of throwing (the assets/liabilities story below).
  //  2. It is more than one fact — expected amount, status, when it landed —
  //     which is three mostly-NULL columns on every transaction ever created.
  //  3. It is sparse: a handful of rows against thousands of transactions.
  //
  // expectedAmount is separate from the transaction's own amount because
  // partial refunds are the normal case: a $200 order with one $60 item sent
  // back is $60 outstanding, not $200. Stored POSITIVE — it is money coming
  // back, and the transaction it hangs off already carries the sign of the
  // original spend.
  //
  // id is 'refund-<transactionId>', derived: one claim per transaction, so
  // both phones marking the same purchase converge on one row rather than
  // each counting its own toward the outstanding total.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tags (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      nameKey     TEXT NOT NULL,
      color       TEXT NOT NULL,
      createdAt   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tags_name_key ON tags(nameKey);

    CREATE TABLE IF NOT EXISTS transaction_tags (
      id            TEXT PRIMARY KEY NOT NULL,
      transactionId TEXT NOT NULL,
      tagId         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transaction_tags_tx ON transaction_tags(transactionId);
    CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tagId);

    CREATE TABLE IF NOT EXISTS refund_claims (
      id              TEXT PRIMARY KEY NOT NULL,
      transactionId   TEXT NOT NULL,
      expectedAmount  REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'awaiting',
      note            TEXT,
      createdAt       TEXT NOT NULL,
      resolvedAt      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refund_claims_status ON refund_claims(status);
  `);

  // -- 2. Self-heal columns on existing tables --------------------------------

  // `funds` predates the Funds grid, so installs that already ran the old
  // CREATE lack sortOrder — CREATE TABLE IF NOT EXISTS would silently skip it.
  await addColumnIfMissing(db, 'funds', 'sortOrder', 'INTEGER NOT NULL DEFAULT 0');
  // Stamped once a legacy balance has become an opening entry. Device-local
  // bookkeeping, never journaled: a co-member on the old build has no such
  // column, and their INSERT OR REPLACE of a payload carrying it would throw.
  await addColumnIfMissing(db, 'fund_balances', 'migratedAt', 'TEXT');
  // The goal → Funds-grid link, opt-in and nullable. Both halves are needed
  // because a fund entry is a CELL: the fund says which savings pot, the
  // account says which institution the money actually sits at. Storing only the
  // fund would leave the checklist unable to say where to file the money, so a
  // goal counts as linked only when both are set.
  //
  // Nullable TEXT with no FK on purpose — FK enforcement is off in this app, so
  // a constraint here would be decoration; features/funds.ts nulls these by hand
  // when the fund or account is deleted.
  //
  // ROLLOUT NOTE: these columns ride along in the savings_goals sync payload
  // (updateSavingsGoal journals the whole row). A household member still on a
  // build without this migration would throw applying that payload, stalling
  // their pull until they update — the same hazard documented on migratedAt
  // above. It self-heals the moment both devices run this file.
  await addColumnIfMissing(db, 'savings_goals', 'targetFundId', 'TEXT');
  await addColumnIfMissing(db, 'savings_goals', 'targetAccountId', 'TEXT');
  // What the goal is FOR — "$3,000 emergency fund", not just "$200/month".
  // Without it the planner has nothing to be funded BY a date, which is the
  // whole of YNAB's target-by-date and Simplifi's fully-funded date. Nullable
  // on purpose: an open-ended "just keep saving" goal is legitimate and must
  // not be forced to invent a number. Same rollout hazard as the two above.
  await addColumnIfMissing(db, 'savings_goals', 'targetAmount', 'REAL');
  await addColumnIfMissing(
    db,
    'categories',
    'rolloverEnabled',
    'INTEGER DEFAULT 0',
  );
  await addColumnIfMissing(db, 'transactions', 'receiptUri', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'memo', 'TEXT');
  // Net worth (features/net-worth.ts). Both tables predate the feature that
  // finally reads them, so installs that already ran the CREATE need patching:
  // liabilities never had a type column at all, and neither table had a note.
  //
  // ROLLOUT NOTE: these columns ride along in the assets/liabilities sync
  // payloads. Unlike the savings_goals case above, a co-member on an older
  // build is SAFE — their build has neither table in SYNCABLE_TABLES, so their
  // pull skips these records outright instead of throwing on the unknown
  // columns. They simply don't see net worth until they update.
  await addColumnIfMissing(db, 'assets', 'note', 'TEXT');
  await addColumnIfMissing(db, 'liabilities', 'note', 'TEXT');
  await addColumnIfMissing(db, 'liabilities', 'type', "TEXT NOT NULL DEFAULT 'other'");

  // -- 3. Seed the well-known rows -------------------------------------------

  await seedCashCard(db);
}

/**
 * Creates the "Cash" card — once per install, for new AND existing installs.
 *
 * `transactions.cardId` is NOT NULL, so every transaction must name a card.
 * Without a card that means "no card", deleting a card had nowhere to put its
 * transactions and destroyed them instead; this row is the destination that
 * makes deleteCard a move rather than a loss.
 *
 * Two separate guards, because they defend against two different failures:
 *
 *  • INSERT OR IGNORE on the well-known id — the row can never exist twice, and
 *    every household member seeds the SAME id, so the two devices converge on
 *    one Cash card instead of one each. Seeding with uuid() is what gave this
 *    household duplicate categories.
 *
 *  • The `cashCardSeededAt` stamp — seeding runs on every launch, so without it
 *    a Cash row deleted through sync (a co-member on an old build tombstoning
 *    it) would silently reappear on the next app start and fight the tombstone
 *    forever. The stamp lives on `app_settings`, which deliberately never syncs,
 *    so it is a per-device record of "this device has already offered to seed
 *    it" rather than shared state. It is intentionally absent from the
 *    AppSettings type: nothing outside this migration ever reads it.
 *
 * Not journaled to the outbox. It cannot be — this runs inside
 * lib/db.ts's openAndMigrate, and queueSyncMutation calls getDb(), which would
 * await the promise that has not resolved yet and deadlock the app on launch.
 * It does not need to be either: the fixed id means the co-member's own seed
 * produces the identical row. lib/queries.ts ensureCashCard covers the one case
 * that does need a journal (a member whose build predates this migration).
 */
async function seedCashCard(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'app_settings', 'cashCardSeededAt', 'TEXT');

  const stamp = await db.getFirstAsync<{ cashCardSeededAt: string | null }>(
    'SELECT cashCardSeededAt FROM app_settings WHERE id = 1',
  );
  if (stamp?.cashCardSeededAt) return;

  await db.runAsync(
    'INSERT OR IGNORE INTO cards (id, name, lastFour, color, sortOrder, billDay, dueDay) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
    // Empty lastFour, not '0000': Cash has no card number, and WalletCard hides
    // the "•••• " line rather than printing digits that were never real.
    [CASH_CARD_ID, CASH_CARD_NAME, '', CASH_CARD_COLOR, CASH_CARD_SORT_ORDER],
  );
  await db.runAsync('UPDATE app_settings SET cashCardSeededAt = ? WHERE id = 1', [
    new Date().toISOString(),
  ]);
}

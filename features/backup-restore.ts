import * as DocumentPicker from 'expo-document-picker';
import { getDb } from '../lib/db';
import { readPickedFileAsText, downloadOrShareFile } from '../lib/files';

// Full-database JSON backup & restore.
//
// Unlike the CSV export (transactions only), this captures every user table so
// a restore reproduces the exact app state. Rows are dumped and re-inserted
// generically (columns come from the row itself), so the backup stays correct
// as the schema gains columns — no hand-maintained column lists to fall out of
// sync with lib/db.ts.

// Version history. A restore branches on this to decide what it is allowed to
// wipe, so it is load-bearing rather than decoration:
//   2 — everything below except the Funds grid.
//   3 — adds funds, fund_accounts, fund_entries and the legacy fund_balances.
//   4 — adds assets and liabilities (Net Worth).
//   5 — adds transaction_splits (one transaction across several categories)
//       and net_worth_snapshots (the net worth trend).
//   6 — adds shared_settings (settings that belong to the shared budget rather
//       than to the phone — currency first).
//   7 — adds tags + transaction_tags (cross-category labels) and refund_claims
//       (money the user is still owed).
export const BACKUP_VERSION = 7;

// Parent tables first so a restore inserts them before the rows that reference
// them. (Deletes run in reverse.) Transient sync state (outbox, sync_meta) is
// intentionally excluded.
export const BACKUP_TABLES = [
  'cards',
  'categories',
  'savings_goals',
  // The Funds grid. funds and fund_accounts are the row and column headers that
  // every fund_entries row points at, so they must be inserted before the
  // entries and deleted after them. fund_balances is the pre-ledger table the
  // backfill still reads (features/funds.ts): leaving it out would drop its
  // migratedAt stamps, and a restored device would then re-create opening
  // entries for cells it had already converted.
  'funds',
  'fund_accounts',
  'fund_entries',
  'fund_balances',
  'transactions',
  // Parts of a split transaction. AFTER transactions: a restore inserts in this
  // order, and parts whose parent is not in yet would be orphans that still
  // count toward category totals.
  'transaction_splits',
  'recurring_transactions',
  'category_rules',
  // Net worth. Standalone rows — nothing references them and they reference
  // nothing, so their position in this order carries no dependency weight.
  'assets',
  'liabilities',
  // The net worth trend. Left out of the first cut, which meant a restore
  // silently dropped every historical point — and unlike a balance, history
  // cannot be re-entered by hand once it is gone.
  'net_worth_snapshots',
  'streaks',
  'category_budgets',
  'savings_goal_budgets',
  'savings_goal_transfers',
  'monthly_settings',
  'app_settings',
  // Settings that belong to the shared budget rather than the phone
  // (features/shared-settings.ts). Standalone rows keyed by household id, so
  // like assets/liabilities their position here carries no dependency weight —
  // appended at the end rather than filed next to app_settings, which they are
  // deliberately NOT part of.
  'shared_settings',
  // Tags (features/tags.ts). `tags` before `transaction_tags` because the join
  // rows point at them, and both are after `transactions` above for the same
  // reason transaction_splits is: a join row restored before its transaction
  // would be an orphan that still counts toward the tag's total.
  'tags',
  'transaction_tags',
  // Refund claims (features/refunds.ts). Also after `transactions` — a claim
  // whose transaction is not in yet is an orphan that inflates the outstanding
  // total with nothing to open.
  //
  // NOTE: receipt PHOTOS are deliberately not here and cannot be. They are
  // files on disk, not rows; features/receipts.ts explains why inlining them
  // would make the backup — the user's only recovery path — large enough to
  // fail on the devices that need it most. The `transactions.receiptUri` column
  // does travel, so a restore knows a receipt was attached and can say the file
  // is missing rather than pretend there never was one.
  'refund_claims',
] as const;

export type Row = Record<string, unknown>;

export type BackupData = {
  version: number;
  timestamp: string;
  tables: Record<string, Row[]>;
};

type SQLiteParam = string | number | null;

/** The first BACKUP_VERSION whose files carry the Funds grid. */
const FUNDS_BACKUP_VERSION = 3;

const FUNDS_TABLES: ReadonlySet<string> = new Set(['funds', 'fund_accounts', 'fund_entries', 'fund_balances']);

/** The first BACKUP_VERSION whose files carry Net Worth. */
const NET_WORTH_BACKUP_VERSION = 4;

const NET_WORTH_TABLES: ReadonlySet<string> = new Set(['assets', 'liabilities']);

/** The first BACKUP_VERSION whose files carry split transactions. */
const SPLITS_BACKUP_VERSION = 5;

// Same rule as Funds and Net Worth: a v4 file simply predates splits, it does
// not assert that the user has none. Wiping the table on restore from an older
// backup would silently collapse every split transaction back onto its single
// fallback category and quietly move money between categories.
const SPLITS_TABLES: ReadonlySet<string> = new Set(['transaction_splits', 'net_worth_snapshots']);

/** The first BACKUP_VERSION whose files carry the shared budget settings. */
const SHARED_SETTINGS_BACKUP_VERSION = 6;

// Same rule again, and it bites harder here than anywhere else: the row is one
// value per household, so wiping it on a v5 restore would leave the household
// with NO shared currency at all, silently dropping both phones back to their
// own local settings — which is precisely the mismatch this table was added to
// end. A v5 file predates the table; it does not say the household has none.
const SHARED_SETTINGS_TABLES: ReadonlySet<string> = new Set(['shared_settings']);

/** The first BACKUP_VERSION whose files carry tags and refund claims. */
const TAGS_REFUNDS_BACKUP_VERSION = 7;

// Same rule as every gate above. Worth stating for tags specifically: the
// tables are a many-to-many, so wiping them on a v6 restore would not lose a
// display preference, it would lose the ONLY record of which transactions
// belonged to which trip — unreconstructable from anything else in the file,
// because a tag leaves no trace on the transaction row itself. Refund claims
// are the same shape of loss: the outstanding total would silently drop to
// zero and read as "nothing is owed".
const TAGS_REFUNDS_TABLES: ReadonlySet<string> = new Set(['tags', 'transaction_tags', 'refund_claims']);

/**
 * The tables a backup of this version is authoritative for — the only ones a
 * restore may wipe.
 *
 * A version-2 file was written by a build that had never heard of the Funds
 * grid. Its silence about funds means "I don't know about that", not "there
 * was nothing there", so wiping on it would turn restoring an old backup into
 * permanent loss of every savings balance in the grid — strictly worse than
 * the missing-funds bug it replaced.
 *
 * Keyed off the declared version rather than off whether the file happens to
 * contain a `funds` key: the version is stated by the writer and checked by
 * validateBackup, whereas a key-presence rule infers intent from an absence and
 * would silently downgrade a truncated current file into a half-merge, with
 * nothing on screen to say so.
 */
export function restorableTables(version: number): readonly string[] {
  return BACKUP_TABLES.filter((table) => {
    if (version < FUNDS_BACKUP_VERSION && FUNDS_TABLES.has(table)) return false;
    // Same rule for Net Worth: a v3 file's silence about assets/liabilities
    // means "I don't know about that", so a restore leaves those rows alone
    // rather than wiping them.
    if (version < NET_WORTH_BACKUP_VERSION && NET_WORTH_TABLES.has(table)) return false;
    if (version < SPLITS_BACKUP_VERSION && SPLITS_TABLES.has(table)) return false;
    if (version < SHARED_SETTINGS_BACKUP_VERSION && SHARED_SETTINGS_TABLES.has(table)) return false;
    if (version < TAGS_REFUNDS_BACKUP_VERSION && TAGS_REFUNDS_TABLES.has(table)) return false;
    return true;
  });
}

/**
 * Reads every user table into a plain object, keyed by table name. Shared by
 * both the local (share-sheet) export and cloud backup, so they stay in sync.
 */
export async function collectAllTables(): Promise<Record<string, Row[]>> {
  const db = await getDb();
  const tables: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
  }
  return tables;
}

/**
 * Wipes and reinserts every table the backup covers, in one transaction so a
 * partial failure leaves existing data untouched. Shared by both local restore
 * and cloud restore.
 *
 * Takes the whole backup rather than just its tables because what may be wiped
 * depends on the file's format version — see restorableTables.
 *
 * Deliberately does NOT journal these writes to the outbox, which is what the
 * restore has always done for the other tables. Journaling would push a whole
 * stale copy of the budget at the other member of a shared household and
 * overwrite what they currently have. The cost is that a restore stays local:
 * a later pull can bring back rows it removed, which is the recoverable
 * direction of the two.
 */
export async function restoreAllTables(backup: BackupData): Promise<void> {
  const db = await getDb();
  const restorable = restorableTables(backup.version);
  await db.withTransactionAsync(async () => {
    // Wipe in reverse dependency order.
    for (let i = restorable.length - 1; i >= 0; i--) {
      await db.runAsync(`DELETE FROM ${restorable[i]}`);
    }

    // Restore in dependency order, inserting each row generically.
    for (const table of restorable) {
      const rows = backup.tables[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map((c) => row[c] as SQLiteParam);
        await db.runAsync(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
          values
        );
      }
    }
  });
}

/**
 * What to tell the user once a restore succeeds.
 *
 * A pre-Funds file leaves the grid untouched while replacing everything else,
 * which contradicts the "this replaces ALL current data" warning they just
 * accepted. Saying it out loud is the difference between trusting the balances
 * still on screen and wondering whether the restore quietly missed them.
 *
 * Deliberately unchanged for v5 and v6, matching what splits did: the two
 * additions since v4 (splits, shared settings) are left alone by an older file
 * and stay exactly as they are on screen, so there is nothing the user would
 * otherwise misread. Naming every table this sentence does not touch would turn
 * a reassurance into a changelog.
 */
export function restoreCompletionMessage(version: number): string {
  // Names everything an older file left ALONE, because the user just accepted a
  // dialog saying "this replaces ALL current data" and that is now not quite
  // what happened. Built by listing what the version predates rather than as a
  // message per version: with five gates there are too many combinations to
  // hand-write, and the ones nobody thought about are exactly the ones that
  // would silently go unmentioned.
  const untouched: string[] = [];
  if (version < FUNDS_BACKUP_VERSION) untouched.push('the Funds grid');
  if (version < NET_WORTH_BACKUP_VERSION) untouched.push('Net Worth');
  if (version < SPLITS_BACKUP_VERSION) untouched.push('split transactions');
  if (version < SHARED_SETTINGS_BACKUP_VERSION) untouched.push('shared budget settings');
  // Two entries, not one "tags and refunds": the list joins with "and", and a
  // compound item makes it read "…, shared budget settings and tags and refunds".
  if (version < TAGS_REFUNDS_BACKUP_VERSION) untouched.push('tags', 'refunds');

  if (untouched.length === 0) return 'Data restored. Please close and reopen the app.';

  const list =
    untouched.length === 1
      ? untouched[0]
      : `${untouched.slice(0, -1).join(', ')} and ${untouched[untouched.length - 1]}`;
  return `Data restored. This backup predates ${list}, so ${
    untouched.length === 1 ? 'that was' : 'those were'
  } left exactly as ${untouched.length === 1 ? 'it is' : 'they are'}. Please close and reopen the app.`;
}

/** Validates a parsed backup's shape/version before any data is touched. */
export function validateBackup(backup: unknown): { valid: true; backup: BackupData } | { valid: false; message: string } {
  if (!backup || typeof backup !== 'object' || !('tables' in backup) || typeof (backup as BackupData).tables !== 'object') {
    return { valid: false, message: 'Invalid backup file structure.' };
  }
  const typed = backup as BackupData;
  if (typeof typed.version !== 'number' || !Number.isFinite(typed.version) || typed.version < 1) {
    return { valid: false, message: "This file isn't a valid KaiJar backup." };
  }
  if (typed.version > BACKUP_VERSION) {
    return {
      valid: false,
      message: 'This backup was made by a newer version of KaiJar. Please update the app first.',
    };
  }
  return { valid: true, backup: typed };
}

/**
 * Serializes every user table into a JSON file and delivers it to the user
 * (native share sheet, or a direct browser download on web).
 */
export async function exportDatabaseToJson(): Promise<boolean> {
  try {
    const tables = await collectAllTables();

    const backup: BackupData = {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      tables,
    };
    const json = JSON.stringify(backup, null, 2);
    return await downloadOrShareFile(json, `kaijar-backup-${Date.now()}.json`, 'application/json', 'Back up KaiJar');
  } catch (error) {
    console.error('Failed to export database:', error);
    return false;
  }
}

/**
 * Prompts the user to pick a JSON backup file and completely replaces the
 * current database with its contents. The wipe + restore runs in a single
 * transaction, so a malformed file leaves the existing data untouched.
 */
export async function importDatabaseFromJson(): Promise<{ success: boolean; message: string }> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) {
      return { success: false, message: 'Import cancelled' };
    }

    const fileContent = await readPickedFileAsText(result.assets[0]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(fileContent);
    } catch {
      return { success: false, message: 'Invalid file — not valid JSON.' };
    }

    const validation = validateBackup(parsed);
    if (!validation.valid) return { success: false, message: validation.message };

    await restoreAllTables(validation.backup);

    return { success: true, message: restoreCompletionMessage(validation.backup.version) };
  } catch (error) {
    console.error('Failed to import database:', error);
    return { success: false, message: 'An unexpected error occurred during import.' };
  }
}

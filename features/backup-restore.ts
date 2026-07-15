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

export const BACKUP_VERSION = 2;

// Parent tables first so a restore inserts them before the rows that reference
// them. (Deletes run in reverse.) Transient sync state (outbox, sync_meta) is
// intentionally excluded.
export const BACKUP_TABLES = [
  'cards',
  'categories',
  'savings_goals',
  'transactions',
  'recurring_transactions',
  'category_rules',
  'streaks',
  'category_budgets',
  'savings_goal_budgets',
  'savings_goal_transfers',
  'monthly_settings',
  'app_settings',
] as const;

export type Row = Record<string, unknown>;

export type BackupData = {
  version: number;
  timestamp: string;
  tables: Record<string, Row[]>;
};

type SQLiteParam = string | number | null;

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
 * Wipes and reinserts every user table from a tables object, in one
 * transaction so a partial failure leaves existing data untouched. Shared by
 * both local restore and cloud restore.
 */
export async function restoreAllTables(tables: Record<string, Row[]>): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // Wipe in reverse dependency order.
    for (let i = BACKUP_TABLES.length - 1; i >= 0; i--) {
      await db.runAsync(`DELETE FROM ${BACKUP_TABLES[i]}`);
    }

    // Restore in dependency order, inserting each row generically.
    for (const table of BACKUP_TABLES) {
      const rows = tables[table];
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

/** Validates a parsed backup's shape/version before any data is touched. */
export function validateBackup(backup: unknown): { valid: true; backup: BackupData } | { valid: false; message: string } {
  if (!backup || typeof backup !== 'object' || !('tables' in backup) || typeof (backup as BackupData).tables !== 'object') {
    return { valid: false, message: 'Invalid backup file structure.' };
  }
  const typed = backup as BackupData;
  if (typeof typed.version !== 'number' || !Number.isFinite(typed.version) || typed.version < 1) {
    return { valid: false, message: "This file isn't a valid Penny Budget backup." };
  }
  if (typed.version > BACKUP_VERSION) {
    return {
      valid: false,
      message: 'This backup was made by a newer version of Penny Budget. Please update the app first.',
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
    return await downloadOrShareFile(json, `penny-budget-backup-${Date.now()}.json`, 'application/json', 'Back up Penny Budget');
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

    await restoreAllTables(validation.backup.tables);

    return { success: true, message: 'Data restored. Please close and reopen the app.' };
  } catch (error) {
    console.error('Failed to import database:', error);
    return { success: false, message: 'An unexpected error occurred during import.' };
  }
}

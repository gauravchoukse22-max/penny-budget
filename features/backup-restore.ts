import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from '../lib/db';

// Full-database JSON backup & restore.
//
// Unlike the CSV export (transactions only), this captures every user table so
// a restore reproduces the exact app state. Rows are dumped and re-inserted
// generically (columns come from the row itself), so the backup stays correct
// as the schema gains columns — no hand-maintained column lists to fall out of
// sync with lib/db.ts.

const BACKUP_VERSION = 2;

// Parent tables first so a restore inserts them before the rows that reference
// them. (Deletes run in reverse.) Transient sync state (outbox, sync_meta) is
// intentionally excluded.
const BACKUP_TABLES = [
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

type Row = Record<string, unknown>;

type BackupData = {
  version: number;
  timestamp: string;
  tables: Record<string, Row[]>;
};

/**
 * Serializes every user table into a JSON file and opens the native share sheet.
 */
export async function exportDatabaseToJson(): Promise<boolean> {
  try {
    const db = await getDb();

    const tables: Record<string, Row[]> = {};
    for (const table of BACKUP_TABLES) {
      tables[table] = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
    }

    const backup: BackupData = {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      tables,
    };

    const fileUri = `${FileSystem.cacheDirectory}penny-budget-backup-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(backup, null, 2));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Back up Penny Budget',
      });
      return true;
    }
    return false;
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

    const fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri);

    let backup: BackupData;
    try {
      backup = JSON.parse(fileContent);
    } catch {
      return { success: false, message: 'Invalid file — not valid JSON.' };
    }

    // Validate before touching any data.
    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      return { success: false, message: 'Invalid backup file structure.' };
    }
    if (backup.version > BACKUP_VERSION) {
      return {
        success: false,
        message: 'This backup was made by a newer version of Penny Budget. Please update the app first.',
      };
    }

    const db = await getDb();

    await db.withTransactionAsync(async () => {
      // Wipe in reverse dependency order.
      for (let i = BACKUP_TABLES.length - 1; i >= 0; i--) {
        await db.runAsync(`DELETE FROM ${BACKUP_TABLES[i]}`);
      }

      // Restore in dependency order, inserting each row generically.
      for (const table of BACKUP_TABLES) {
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

    return { success: true, message: 'Data restored. Please close and reopen the app.' };
  } catch (error) {
    console.error('Failed to import database:', error);
    return { success: false, message: 'An unexpected error occurred during import.' };
  }
}

type SQLiteParam = string | number | null;

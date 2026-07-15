import { getDb } from '../lib/db';
import { uuid } from '../lib/uuid';

// ---------------------------------------------------------------------------
// Offline-first sync engine.
//
// Every local write is journaled to an `outbox` table (see queueSyncMutation,
// called from lib/queries.ts). A sync cycle drains the outbox to a remote store
// (push) and applies remote changes back into the local tables (pull), tracking
// a server change token in `sync_meta`.
//
// The remote is abstracted behind CloudKitAdapter. The default adapter is a
// no-op mock so the whole engine runs and is testable WITHOUT any native code.
// A real iCloud/CloudKit adapter is a native module (Swift + Expo config
// plugin) that the app registers at startup via setCloudKitAdapter() — see
// docs/cloudkit-setup.md. Until that native module ships, sync is a safe no-op.
// ---------------------------------------------------------------------------

export type SyncAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type OutboxRecord = {
  id: string;
  action: SyncAction;
  tableName: string;
  recordId: string;
  payload: string; // JSON string
  createdAt: string;
};

export type RemoteRecord = {
  recordType: string; // maps to a local table name
  recordId: string;
  fields: Record<string, unknown>;
};

export type RemoteChanges = {
  changed: RemoteRecord[];
  deleted: Array<{ recordType: string; recordId: string }>;
  newToken: string | null;
};

/**
 * The seam a real CloudKit native module implements. The mock below satisfies
 * it with local no-ops so the engine is fully exercisable in tests and JS-only
 * builds.
 */
export interface CloudKitAdapter {
  /** True only when a real remote backend is wired up. */
  readonly isAvailable: boolean;
  saveRecord(recordType: string, recordId: string, fields: Record<string, unknown>): Promise<void>;
  deleteRecord(recordType: string, recordId: string): Promise<void>;
  fetchChanges(previousToken: string | null): Promise<RemoteChanges>;
}

/** No-op adapter: the app behaves exactly as a local-only app would. */
export const mockCloudKitAdapter: CloudKitAdapter = {
  isAvailable: false,
  async saveRecord() {},
  async deleteRecord() {},
  async fetchChanges(previousToken) {
    return { changed: [], deleted: [], newToken: previousToken };
  },
};

let activeAdapter: CloudKitAdapter = mockCloudKitAdapter;

// Cached mirror of app_settings.cloudSyncEnabled, set at startup and whenever
// the setting changes. When false, writes are NOT journaled to the outbox, so a
// local-only user pays no cost and the outbox never grows.
let syncEnabled = false;

/** Enable/disable outbox journaling. Call from startup and on settings change. */
export function setSyncEnabled(enabled: boolean): void {
  syncEnabled = enabled;
}

export function isSyncEnabled(): boolean {
  return syncEnabled;
}

/** Register the real native adapter at app startup (see docs/cloudkit-setup.md). */
export function setCloudKitAdapter(adapter: CloudKitAdapter): void {
  activeAdapter = adapter;
}

export function getCloudKitAdapter(): CloudKitAdapter {
  return activeAdapter;
}

// Only these tables may be synced / applied from remote — guards against a
// malformed remote record naming an arbitrary table.
const SYNCABLE_TABLES = new Set([
  'cards',
  'categories',
  'transactions',
  'savings_goals',
  'recurring_transactions',
  'category_rules',
  'category_budgets',
  'savings_goal_budgets',
  'savings_goal_transfers',
  'monthly_settings',
]);

/**
 * Journals a local mutation for later sync. Call from inside the same logical
 * operation as the local write (see lib/queries.ts). Cheap and always safe —
 * the outbox is drained only when a sync cycle runs.
 */
export async function queueSyncMutation(
  action: SyncAction,
  tableName: string,
  recordId: string,
  payload: unknown
): Promise<void> {
  if (!syncEnabled) return;
  if (!SYNCABLE_TABLES.has(tableName)) return;
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO outbox (id, action, tableName, recordId, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid(), action, tableName, recordId, JSON.stringify(payload ?? {}), new Date().toISOString()]
  );
}

/** Drains the outbox to the remote (oldest first), deleting each entry on success. */
export async function pushPendingChangesToCloudKit(
  adapter: CloudKitAdapter = activeAdapter
): Promise<{ success: boolean; pushedCount: number }> {
  try {
    const db = await getDb();
    const pending = await db.getAllAsync<OutboxRecord>('SELECT * FROM outbox ORDER BY createdAt ASC');
    let pushedCount = 0;

    for (const record of pending) {
      if (record.action === 'DELETE') {
        await adapter.deleteRecord(record.tableName, record.recordId);
      } else {
        await adapter.saveRecord(record.tableName, record.recordId, JSON.parse(record.payload));
      }
      await db.runAsync('DELETE FROM outbox WHERE id = ?', [record.id]);
      pushedCount++;
    }

    return { success: true, pushedCount };
  } catch (error) {
    console.error('Sync push error:', error);
    return { success: false, pushedCount: 0 };
  }
}

/** Applies remote changes into local tables and advances the change token. */
export async function pullChangesFromCloudKit(
  adapter: CloudKitAdapter = activeAdapter
): Promise<{ success: boolean; pulledCount: number }> {
  try {
    const db = await getDb();
    const meta = await db.getFirstAsync<{ syncToken: string | null }>(
      "SELECT syncToken FROM sync_meta WHERE id = 'main'"
    );
    const lastToken = meta?.syncToken ?? null;

    const changes = await adapter.fetchChanges(lastToken);
    let pulledCount = 0;

    await db.withTransactionAsync(async () => {
      for (const rec of changes.changed) {
        if (!SYNCABLE_TABLES.has(rec.recordType)) continue;
        const cols = Object.keys(rec.fields);
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map((c) => rec.fields[c] as string | number | null);
        // INSERT OR REPLACE keyed on primary key (id) is a last-writer-wins upsert.
        await db.runAsync(
          `INSERT OR REPLACE INTO ${rec.recordType} (${cols.join(', ')}) VALUES (${placeholders})`,
          values
        );
        pulledCount++;
      }

      for (const del of changes.deleted) {
        if (!SYNCABLE_TABLES.has(del.recordType)) continue;
        await db.runAsync(`DELETE FROM ${del.recordType} WHERE id = ?`, [del.recordId]);
        pulledCount++;
      }

      await db.runAsync("INSERT OR REPLACE INTO sync_meta (id, syncToken) VALUES ('main', ?)", [
        changes.newToken,
      ]);
    });

    return { success: true, pulledCount };
  } catch (error) {
    console.error('Sync pull error:', error);
    return { success: false, pulledCount: 0 };
  }
}

/**
 * Full sync cycle: push local changes, then pull remote changes. Safe to call
 * on startup and periodically. With the mock adapter this is a no-op that
 * simply clears any queued outbox rows against the local (empty) remote.
 */
export async function runCloudKitSyncCycle(adapter: CloudKitAdapter = activeAdapter): Promise<void> {
  const push = await pushPendingChangesToCloudKit(adapter);
  if (push.success) {
    await pullChangesFromCloudKit(adapter);
  }
}

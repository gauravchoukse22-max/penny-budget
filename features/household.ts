// Family sharing — co-edit ONE shared household budget.
//
// This is a Supabase-backed adapter for the existing offline-first sync engine
// (cloudkit-sync.ts). When the signed-in user is in a household, we register
// this adapter and enable outbox journaling; every local budget write then
// syncs through the shared `household_records` mirror, scoped by RLS to the
// household's members. See supabase/migrations/20260717010000_household_sharing.sql.
import { getDb } from '../lib/db';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  type CloudKitAdapter,
  type RemoteChanges,
  SYNCABLE_TABLES,
  setCloudKitAdapter,
  setSyncEnabled,
  mockCloudKitAdapter,
} from './cloudkit-sync';

export type Household = { id: string; name: string; role: 'owner' | 'member'; memberCount: number };
export type HouseholdMember = { userId: string; email: string | null; role: 'owner' | 'member' };

type Result<T = void> = { success: boolean; message: string; data?: T };

const RECORDS_TABLE = 'household_records';

/** Adapter that maps the generic sync seam onto the household_records mirror. */
class SupabaseHouseholdAdapter implements CloudKitAdapter {
  readonly isAvailable = true;
  constructor(private householdId: string) {}

  async saveRecord(recordType: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
    if (!SYNCABLE_TABLES.has(recordType)) return;
    const { error } = await supabase.from(RECORDS_TABLE).upsert(
      {
        household_id: this.householdId,
        record_type: recordType,
        record_id: recordId,
        payload: fields,
        deleted: false,
        updated_at: new Date().toISOString(),
        updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      },
      { onConflict: 'household_id,record_type,record_id' }
    );
    if (error) throw error;
  }

  async deleteRecord(recordType: string, recordId: string): Promise<void> {
    if (!SYNCABLE_TABLES.has(recordType)) return;
    // Soft delete (tombstone) so other devices learn the row is gone.
    const { error } = await supabase.from(RECORDS_TABLE).upsert(
      {
        household_id: this.householdId,
        record_type: recordType,
        record_id: recordId,
        payload: { id: recordId },
        deleted: true,
        updated_at: new Date().toISOString(),
        updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      },
      { onConflict: 'household_id,record_type,record_id' }
    );
    if (error) throw error;
  }

  async fetchChanges(previousToken: string | null): Promise<RemoteChanges> {
    let query = supabase
      .from(RECORDS_TABLE)
      .select('record_type, record_id, payload, deleted, updated_at')
      .eq('household_id', this.householdId)
      .order('updated_at', { ascending: true });
    if (previousToken) query = query.gt('updated_at', previousToken);

    const { data, error } = await query;
    if (error) throw error;

    const changes: RemoteChanges = { changed: [], deleted: [], newToken: previousToken };
    for (const row of data ?? []) {
      if (!SYNCABLE_TABLES.has(row.record_type)) continue;
      if (row.deleted) {
        changes.deleted.push({ recordType: row.record_type, recordId: row.record_id });
      } else {
        changes.changed.push({
          recordType: row.record_type,
          recordId: row.record_id,
          fields: (row.payload ?? {}) as Record<string, unknown>,
        });
      }
      changes.newToken = row.updated_at; // rows are ascending → last is the max
    }
    return changes;
  }
}

let activeHouseholdId: string | null = null;

/** Turn on household sync: register the adapter and start journaling writes. */
export function activateHousehold(householdId: string): void {
  activeHouseholdId = householdId;
  setCloudKitAdapter(new SupabaseHouseholdAdapter(householdId));
  setSyncEnabled(true);
}

/** Turn off household sync and revert to the local-only no-op adapter. */
export function deactivateHousehold(): void {
  activeHouseholdId = null;
  setCloudKitAdapter(mockCloudKitAdapter);
  setSyncEnabled(false);
}

export function getActiveHouseholdId(): string | null {
  return activeHouseholdId;
}

/** Pushes every current local budget row up to the household (used right after
 * creating a household, so the creator's budget becomes the shared one). */
export async function seedHouseholdFromLocal(householdId: string): Promise<void> {
  const adapter = new SupabaseHouseholdAdapter(householdId);
  const db = await getDb();
  for (const table of SYNCABLE_TABLES) {
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`);
    for (const row of rows) {
      const id = row.id as string | undefined;
      if (!id) continue;
      await adapter.saveRecord(table, id, row);
    }
  }
}

// ── RPC wrappers ────────────────────────────────────────────────────────────

const NOT_CONFIGURED: Result<any> = { success: false, message: "Cloud accounts aren't configured for this build." };

export async function createHousehold(name?: string): Promise<Result<string>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('create_household', { household_name: name ?? 'Our Household' });
  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Household created.', data: data as string };
}

export async function joinHousehold(code: string): Promise<Result<string>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('join_household', { invite_code: code.trim().toUpperCase() });
  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Joined household.', data: data as string };
}

export async function leaveHousehold(householdId: string): Promise<Result> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('leave_household', { hid: householdId });
  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Left household.' };
}

export async function removeMember(householdId: string, targetUserId: string): Promise<Result> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('remove_household_member', { hid: householdId, target: targetUserId });
  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Member removed.' };
}

export async function createInvite(householdId: string): Promise<Result<string>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('create_household_invite', { hid: householdId });
  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Invite created.', data: data as string };
}

export async function myHouseholds(): Promise<Household[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('my_households');
  if (error || !data) return [];
  return (data as any[]).map((h) => ({ id: h.id, name: h.name, role: h.role, memberCount: Number(h.member_count) }));
}

export async function listMembers(householdId: string): Promise<HouseholdMember[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, email, role')
    .eq('household_id', householdId);
  if (error || !data) return [];
  return data.map((m: any) => ({ userId: m.user_id, email: m.email, role: m.role }));
}

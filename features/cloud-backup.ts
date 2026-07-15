import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { collectAllTables, restoreAllTables, validateBackup, BACKUP_VERSION, type BackupData } from './backup-restore';

const BUCKET = 'backups';
const OBJECT_NAME = 'backup.json';

function objectPath(userId: string): string {
  return `${userId}/${OBJECT_NAME}`;
}

/** Pushes a full snapshot of the local database to the signed-in user's private cloud backup. */
export async function backupToCloud(userId: string): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured) {
    return { success: false, message: "Cloud accounts aren't configured for this build." };
  }
  try {
    const tables = await collectAllTables();
    const backup: BackupData = {
      version: BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      tables,
    };

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath(userId), JSON.stringify(backup), {
        contentType: 'application/json',
        upsert: true,
      });

    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Backed up to the cloud.' };
  } catch (error) {
    console.error('Failed to back up to cloud:', error);
    return { success: false, message: 'An unexpected error occurred during backup.' };
  }
}

/** Downloads the signed-in user's latest cloud backup and replaces all local data with it. */
export async function restoreFromCloud(userId: string): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured) {
    return { success: false, message: "Cloud accounts aren't configured for this build." };
  }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(userId));

    if (error) {
      // Supabase Storage returns a generic "Object not found" error for a missing key.
      if (error.message.toLowerCase().includes('not found')) {
        return { success: false, message: 'No cloud backup found for this account yet.' };
      }
      return { success: false, message: error.message };
    }

    const text = await data.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { success: false, message: 'Cloud backup is corrupted — not valid JSON.' };
    }

    const validation = validateBackup(parsed);
    if (!validation.valid) return { success: false, message: validation.message };

    await restoreAllTables(validation.backup.tables);

    return { success: true, message: 'Data restored. Please close and reopen the app.' };
  } catch (error) {
    console.error('Failed to restore from cloud:', error);
    return { success: false, message: 'An unexpected error occurred during restore.' };
  }
}

/** Returns when the user's cloud backup was last written, or null if none exists. */
export async function getLastCloudBackupTimestamp(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.storage.from(BUCKET).list(userId);
  if (error || !data) return null;
  const entry = data.find((f) => f.name === OBJECT_NAME);
  return entry?.updated_at ?? null;
}

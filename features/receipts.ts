// ---------------------------------------------------------------------------
// features/receipts.ts – Attach a photo (or a PDF) to a transaction.
//
// `transactions.receiptUri` has existed since the intelligence-engine work and
// was read and written by NOTHING — a column that looked shipped. This module
// is what finally uses it. No migration needed; it is already there.
//
// ── BLOCKER: there is no photo picker in this build ─────────────────────────
// expo-image-picker is NOT a dependency (checked package.json, package-lock and
// node_modules — absent from all three) and is deliberately NOT being added
// here: it is a native module, so adding it without a full native rebuild ships
// a feature that is dead on the device while looking fine in TypeScript. That
// has already happened once in this repo.
//
// So the source is expo-document-picker, which IS installed and already proven
// on device by features/backup-restore.ts. The cost is real and worth stating
// plainly: on iOS that opens Files, not Photos, so a receipt photographed with
// the camera is not reachable until expo-image-picker lands. What it DOES cover
// today is the emailed-PDF and screenshot-saved-to-Files case, which is a large
// share of real receipts. Everything below — storage, journaling, orphan
// cleanup, the backup story — is the same either way, so swapping in
// expo-image-picker later is a change to pickReceiptAsset() alone.
//
// ── Storage: a RELATIVE path, and the file is NOT in the backup ─────────────
// Two decisions, both load-bearing.
//
// 1. `receiptUri` stores `receipts/<transactionId>.<ext>`, relative to the
//    app's document directory — never the absolute file:// URI. On iOS the app
//    container's UUID changes on reinstall and on restore-from-backup, so an
//    absolute path recorded today is dead the moment the user gets a new phone.
//    The stored value would still look perfectly valid; every receipt would
//    just silently fail to open. Resolving against documentDirectory at READ
//    time survives that.
//
// 2. The image bytes are NOT inlined into the JSON backup, and must not be.
//    features/backup-restore.ts builds the whole backup as one JSON string in
//    memory and hands it to the share sheet; base64 inflates binary by ~33%, so
//    a dozen phone photos turns a ~1 MB backup into a ~50 MB one that an older
//    device may fail to stringify or re-parse. The backup is the user's ONLY
//    recovery path — making it fragile to protect photos is the wrong trade.
//    What DOES travel in the backup is the receiptUri column, so after a
//    restore the app knows a receipt was attached and can say the file is
//    missing, rather than pretending there never was one.
//
//    The same reasoning applies to sync: the path syncs (it is a column on
//    transactions), the file does not. A co-member opening the transaction sees
//    "photo is on the other device" instead of a broken image. hasReceiptFile()
//    is what lets the UI tell those apart, and the UI is required to say so —
//    silently showing nothing would read as "the photo was lost".
//
// Sync contract: writing the column journals the transaction row through
// journalRowsAsUpdates (AGENTS.md rule 2). `transactions` is already syncable.
// ---------------------------------------------------------------------------

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
// The legacy namespace, matching lib/files.ts. The new expo-file-system API is
// class-based and this file has no reason to be the one place in the repo that
// uses a different one.
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../lib/db';
import { journalRowsAsUpdates } from '../lib/queries';

/** Where receipts live inside the document directory. */
const RECEIPT_DIR = 'receipts';

/**
 * Extensions we are willing to store, mapped from what the picker reports.
 *
 * A whitelist rather than "whatever the file was called": the stored value ends
 * up in a path we later hand to the OS, and an arbitrary user-supplied
 * extension is not something to pass through unchecked. Anything unrecognised
 * is stored as .bin and still opens through the share sheet.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'pdf']);

// ── Pure helpers (covered by scripts/test-tags.mjs) ─────────────────────────

/**
 * The extension to store a picked file under.
 *
 * MIME type first because it is what the OS actually asserts about the bytes;
 * the filename is a fallback, since Android content:// picks frequently arrive
 * with a display name that has no extension at all.
 */
export function receiptExtension(mimeType: string | null | undefined, fileName: string | null | undefined): string {
  const byMime = mimeType ? EXTENSION_BY_MIME[mimeType.toLowerCase().split(';')[0].trim()] : undefined;
  if (byMime) return byMime;
  const raw = (fileName ?? '').toLowerCase().split('.').pop() ?? '';
  if (ALLOWED_EXTENSIONS.has(raw)) return raw === 'jpeg' ? 'jpg' : raw === 'heif' ? 'heic' : raw;
  return 'bin';
}

/**
 * The value stored in `transactions.receiptUri`.
 *
 * Named after the TRANSACTION, not the picked file. Two reasons: the picked
 * name is user data that would then sit in a path (and on the co-member's
 * device after sync), and a derived name means re-attaching a receipt
 * overwrites the old one instead of leaving an unreferenced file behind on
 * disk with nothing left to point at it.
 */
export function receiptRelativePath(transactionId: string, extension: string): string {
  return `${RECEIPT_DIR}/${transactionId}.${extension}`;
}

/**
 * True for a value written by an older or newer build that stored an ABSOLUTE
 * uri instead of a relative path.
 *
 * Nothing in this build writes one, but the column is synced: a co-member on a
 * different build can push one, and treating it as relative would produce a
 * nonsense path. Detected rather than migrated — rewriting another device's
 * value would just push our own guess back at them.
 */
export function isAbsoluteReceiptUri(stored: string): boolean {
  return stored.startsWith('file://') || stored.startsWith('/') || stored.startsWith('content://');
}

// ── Path resolution ─────────────────────────────────────────────────────────

/**
 * The absolute uri to read, or null when it cannot be resolved.
 *
 * Null on web, where expo-file-system/legacy is a no-op shim and
 * documentDirectory is null — the same guard lib/files.ts makes.
 */
export function resolveReceiptUri(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (isAbsoluteReceiptUri(stored)) return stored;
  const base = FileSystem.documentDirectory;
  if (!base) return null;
  return `${base}${stored}`;
}

/**
 * Whether the file is actually on THIS device.
 *
 * The distinction the UI depends on: a transaction can legitimately carry a
 * receiptUri whose file lives on the household's other phone, or that was lost
 * when a backup was restored onto a new device. Both need to say so rather than
 * render an empty box.
 */
export async function hasReceiptFile(stored: string | null | undefined): Promise<boolean> {
  const uri = resolveReceiptUri(stored);
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    // getInfoAsync throws rather than returning false for some content:// uris.
    // A receipt we cannot stat is a receipt we cannot show, which is the same
    // answer as far as the UI is concerned.
    return false;
  }
}

// ── Picking + attaching ─────────────────────────────────────────────────────

export type PickedReceipt = { uri: string; mimeType: string | null; fileName: string | null };

/**
 * Opens the system picker. Returns null when the user cancels.
 *
 * The one function that would change if expo-image-picker were added — see the
 * blocker note at the top of this file.
 */
export async function pickReceiptAsset(): Promise<PickedReceipt | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    // Copied into the app's cache first: the picker's raw uri is a temporary
    // security-scoped handle on iOS that is not readable once the picker is
    // gone, so copying from it later would fail intermittently and look random.
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? null, fileName: asset.name ?? null };
}

/**
 * Copies a picked file into the app's document directory and records it on the
 * transaction. Returns the stored relative path, or null if it could not be
 * stored.
 *
 * Copied rather than referenced in place: the picker hands back a cache uri,
 * and the OS empties the cache whenever it feels like it — a referenced receipt
 * would simply stop existing days later with nothing to explain it.
 */
export async function attachReceipt(transactionId: string, picked: PickedReceipt): Promise<string | null> {
  const base = FileSystem.documentDirectory;
  if (!base || Platform.OS === 'web') return null;

  const extension = receiptExtension(picked.mimeType, picked.fileName);
  const relative = receiptRelativePath(transactionId, extension);
  const destination = `${base}${relative}`;

  await FileSystem.makeDirectoryAsync(`${base}${RECEIPT_DIR}`, { intermediates: true });
  // Re-attaching uses the same derived name, and copyAsync will not overwrite —
  // clear the old one first rather than leaving the previous receipt in place
  // while the database says a new one was attached.
  await FileSystem.deleteAsync(destination, { idempotent: true });
  await FileSystem.copyAsync({ from: picked.uri, to: destination });

  await setReceiptUri(transactionId, relative);
  return relative;
}

/**
 * Removes the receipt: the file from disk AND the column.
 *
 * The column is cleared even if deleting the file fails. A row pointing at a
 * file that is not there is the state this module works hardest to avoid, and
 * leaving one behind to protect a few kilobytes on disk is the wrong way round.
 */
export async function detachReceipt(transactionId: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ receiptUri: string | null }>(
    'SELECT receiptUri FROM transactions WHERE id = ?',
    [transactionId]
  );
  const uri = resolveReceiptUri(row?.receiptUri);
  if (uri && !isAbsoluteReceiptUri(row?.receiptUri ?? '')) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Best effort — see above.
    }
  }
  await setReceiptUri(transactionId, null);
}

/**
 * Writes the column and journals the transaction row.
 *
 * lib/queries.ts updateTransaction does not touch receiptUri (its UPDATE names
 * six columns and this is not one of them), so it can neither write nor
 * accidentally clear this — which is why the write lives here. The journal goes
 * through journalRowsAsUpdates so the payload is the row READ BACK, carrying
 * every other column with it; journaling a two-field patch would push a partial
 * row, and the pull applies payloads with INSERT OR REPLACE, which would blank
 * every column the payload omitted.
 */
async function setReceiptUri(transactionId: string, relativePath: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE transactions SET receiptUri = ? WHERE id = ?', [relativePath, transactionId]);
  await journalRowsAsUpdates('transactions', [transactionId]);
}

export async function getReceiptUri(transactionId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ receiptUri: string | null }>(
    'SELECT receiptUri FROM transactions WHERE id = ?',
    [transactionId]
  );
  return row?.receiptUri ?? null;
}

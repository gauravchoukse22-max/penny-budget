import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { DocumentPickerAsset } from 'expo-document-picker';

/**
 * Reads a DocumentPicker asset's text content. Native has a real file path
 * FileSystem can read; web's expo-file-system/legacy is a no-op shim
 * (cacheDirectory is null there, and read/write throw), but the picker hands
 * back the actual browser File object, so read that directly instead.
 */
export async function readPickedFileAsText(asset: DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('No file content available.');
    return asset.file.text();
  }
  return FileSystem.readAsStringAsync(asset.uri);
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Manual base64 decode — atob isn't guaranteed on Hermes. */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_ALPHABET.indexOf(clean[i]);
    const b = B64_ALPHABET.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c !== -1) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/**
 * Reads a DocumentPicker asset as raw bytes (for binary formats like PDF).
 * Web reads the browser File directly; native reads the picked URI as base64
 * through expo-file-system and decodes it.
 */
export async function readPickedFileAsBytes(asset: DocumentPickerAsset): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('No file content available.');
    return new Uint8Array(await asset.file.arrayBuffer());
  }
  const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any });
  return base64ToBytes(b64);
}

/**
 * Delivers text content to the user as a file. On web there's no share sheet
 * or writable cache directory (expo-file-system/legacy is a no-op shim there),
 * so this triggers a direct browser download; on native it writes to the
 * cache dir and opens the native share sheet. Returns whether delivery
 * happened (native share can be unavailable on some devices).
 */
export async function downloadOrShareFile(content: string, filename: string, mimeType: string, dialogTitle: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType, dialogTitle });
    return true;
  }
  return false;
}

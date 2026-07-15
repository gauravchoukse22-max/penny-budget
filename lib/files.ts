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

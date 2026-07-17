// Screen-privacy helpers.
//
// Two distinct protections:
//  1. App-switcher cover — blurs the app snapshot iOS shows in the multitasking
//     switcher. Enabled app-wide while the app lock is on. iOS-only native API.
//  2. Sensitive-screen capture block — FLAG_SECURE on Android / recording block
//     on iOS, SCOPED to screens with secrets on them (password entry). Not
//     app-wide on purpose: users legitimately screenshot their charts.
import { Platform } from 'react-native';
import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

export async function enableAppSwitcherCover(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await ScreenCapture.enableAppSwitcherProtectionAsync();
  } catch {
    // Older OS / unsupported — the app lock is still the primary defense.
  }
}

export async function disableAppSwitcherCover(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await ScreenCapture.disableAppSwitcherProtectionAsync();
  } catch {
    /* no-op */
  }
}

/**
 * Blocks screenshots/recording while the calling screen is mounted, then
 * restores capture on unmount. Use only on screens that display secrets.
 */
export function useSensitiveScreen(key: string): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
    };
  }, [key]);
}

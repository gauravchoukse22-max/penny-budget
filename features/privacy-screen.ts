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

// One shared tag + our own reference count, so the NATIVE prevent runs exactly
// once no matter how many sensitive screens are stacked.
//
// Why this matters: expo-screen-capture de-dupes per key, so two screens with
// DIFFERENT keys each fire the native call. On iOS that call re-parents the key
// window's layer inside a secure UITextField; a second call nests the window
// inside a SECOND text field and overwrites the saved `originalParent` — the
// window ends up in a double-secure layer tree that renders as a BLACK SCREEN,
// and the first text field is orphaned so unwinding can never restore it.
// (Repro: open Account, which is sensitive, then push Security, also sensitive.)
//
// Counting here keeps the guarantee the screens actually want — protection is on
// while ANY sensitive screen is mounted, and released only when the last unmounts.
const SENSITIVE_TAG = 'sensitive-screen';
let sensitiveScreenCount = 0;

/**
 * Blocks screenshots/recording while the calling screen is mounted, then
 * restores capture when the LAST sensitive screen unmounts. Use only on screens
 * that display secrets. Safe to nest — see SENSITIVE_TAG above.
 *
 * @param key Retained for readability at the call site; the native layer is
 *   driven by the shared tag, not this value.
 */
export function useSensitiveScreen(key: string): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    sensitiveScreenCount += 1;
    if (sensitiveScreenCount === 1) {
      ScreenCapture.preventScreenCaptureAsync(SENSITIVE_TAG).catch(() => {});
    }

    return () => {
      sensitiveScreenCount = Math.max(0, sensitiveScreenCount - 1);
      if (sensitiveScreenCount === 0) {
        ScreenCapture.allowScreenCaptureAsync(SENSITIVE_TAG).catch(() => {});
      }
    };
    // Intentionally not keyed on `key`: the native protection is global and
    // reference-counted, so re-running per key would reintroduce the bug above.
  }, []);
}

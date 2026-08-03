import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Blocks Android's hardware/gesture back on a screen that must not be dismissed
 * ACCIDENTALLY mid-flow.
 *
 * A navigator's `gestureEnabled: false` only stops the iOS swipe — Android's
 * back button routes through BackHandler and pops the screen anyway, which
 * would strand a half-finished password reset or import. Returning `true` from
 * the listener swallows the press. No-op on iOS.
 *
 * `onBlocked` is how a screen stays escapable. Swallowing the press with no
 * alternative is how the import preview became a dead end: modal presentation
 * gave it no back button, this hook ate the Android one, and the only way off
 * the screen was to import transactions the user had decided they didn't want.
 * A screen that blocks back MUST offer a deliberate way out — pass `onBlocked`
 * to run the same confirm-and-leave the header's Cancel button runs.
 */
export function useAndroidBackGuard(enabled: boolean = true, onBlocked?: () => void) {
  // Kept in a ref so a re-created callback doesn't re-register the listener.
  const handler = useRef(onBlocked);
  handler.current = onBlocked;

  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handler.current?.();
      return true;
    });
    return () => subscription.remove();
  }, [enabled]);
}

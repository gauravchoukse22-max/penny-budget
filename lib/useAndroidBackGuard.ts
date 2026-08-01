import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Blocks Android's hardware/gesture back on a screen that must not be dismissed
 * mid-flow.
 *
 * A navigator's `gestureEnabled: false` only stops the iOS swipe — Android's
 * back button routes through BackHandler and pops the screen anyway, which
 * would strand a half-finished password reset or import. Returning `true` from
 * the listener swallows the press. No-op on iOS.
 */
export function useAndroidBackGuard(enabled: boolean = true) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [enabled]);
}

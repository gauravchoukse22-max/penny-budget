import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Thin wrapper so screens can fire haptics without repeating the Platform
// guard everywhere. Haptics are a no-op on web (and silently swallow errors
// on devices that lack a Taptic Engine).
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(run: () => Promise<unknown>) {
  if (!enabled) return;
  run().catch(() => {});
}

/** A light tap — selection changes, toggles, chip picks. */
export function tapLight() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A firmer tap — committing an edit, opening a sheet. */
export function tapMedium() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** iOS selection tick — moving between options (month swipe, steppers). */
export function selection() {
  safe(() => Haptics.selectionAsync());
}

/** Positive resolution — saved, goal completed, finished under budget. */
export function success() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Something crossed a limit / went over budget. */
export function warning() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

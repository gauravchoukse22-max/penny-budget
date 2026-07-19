import { Alert, Platform } from 'react-native';

// Cross-platform confirm / notify.
//
// react-native-web ships Alert as a literal no-op (`static alert() {}`), so
// every Alert.alert confirmation silently does nothing on the web build — the
// dialog never shows AND the confirm button's onPress never fires. These
// helpers use the browser's native dialogs on web and real Alert on native,
// and return a Promise so callers read top-to-bottom instead of nesting
// button callbacks.

export function confirmAction(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive } = opts;

  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}

/** Fire-and-forget info message; also works on web (RN-web Alert is a no-op). */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

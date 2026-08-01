import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';

const IS_ANDROID = Platform.OS === 'android';

type KeyboardAwareScreenProps = Omit<ScrollViewProps, 'style'> & {
  children: React.ReactNode;
  /** Fills the whole screen, including the strip the keyboard slides over. */
  backgroundColor?: string;
};

/**
 * Scrolling screen wrapper that guarantees the focused text field stays above
 * the keyboard. Every screen with a text input should use this instead of
 * hand-rolling a KeyboardAvoidingView, because the two platforms need opposite
 * things and getting either one wrong leaves the field hidden.
 *
 * iOS — the ScrollView insets itself natively (`automaticallyAdjustKeyboardInsets`).
 * UIScrollView measures the keyboard against the scroll view's real position on
 * screen and also scrolls the first responder into view, so a header, a modal
 * presentation, or a safe-area inset can't throw the maths off. The old
 * `behavior="padding"` + `keyboardVerticalOffset={0}` setup only shrank the
 * scroll view and never scrolled — which is why a field lower down the form
 * stayed under the keyboard.
 *
 * Android — `automaticallyAdjustKeyboardInsets` is iOS-only, so a
 * KeyboardAvoidingView does the padding and the platform ScrollView then pulls
 * the focused EditText back into view. It is deliberately disabled on iOS:
 * running both mechanisms would push the content up twice.
 */
export function KeyboardAwareScreen({
  children,
  backgroundColor,
  ...scrollProps
}: KeyboardAwareScreenProps) {
  const containerRef = useRef<View>(null);
  const [topOffset, setTopOffset] = useState(0);

  // KeyboardAvoidingView measures its own frame relative to its PARENT but
  // compares it against the keyboard's position on the SCREEN. Anything sitting
  // above this wrapper — a navigation header, the status bar, a modal's inset —
  // makes the two disagree and it under-pads by exactly that much. Reporting our
  // real distance from the top of the window is what keyboardVerticalOffset is
  // for, and it also self-corrects to zero on the Android builds where the
  // window still resizes for the keyboard, so we never double-pad.
  const measure = useCallback(() => {
    if (!IS_ANDROID) return;
    containerRef.current?.measureInWindow((_x, y) => {
      if (!Number.isFinite(y)) return;
      setTopOffset((prev) => (Math.abs(prev - y) > 1 ? y : prev));
    });
  }, []);

  return (
    <View
      ref={containerRef}
      onLayout={measure}
      style={[styles.fill, backgroundColor ? { backgroundColor } : null]}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={IS_ANDROID ? 'padding' : undefined}
        enabled={IS_ANDROID}
        keyboardVerticalOffset={topOffset}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          {...scrollProps}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

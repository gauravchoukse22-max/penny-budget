import React from 'react';
import { Keyboard, StyleSheet, TouchableWithoutFeedback, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Taps on empty space inside this dismiss the keyboard.
 *
 * Needed because a keyboard with no visible "Done" is a trap: the user taps a
 * field (often by accident, or having changed their mind), the keyboard covers
 * half the screen, and nothing on screen says how to put it away. iOS users
 * expect tapping outside to work, and it silently didn't on the sheets and
 * screens that never got KeyboardAwareScreen.
 *
 * ── Why this doesn't eat your buttons ──────────────────────────────────────
 * TouchableWithoutFeedback only fires when no child claims the touch. A
 * Pressable, a TextInput or a list row claims it first, so their onPress still
 * runs and this never sees the tap. Only taps that would otherwise have gone
 * nowhere reach us.
 *
 * `accessible={false}` keeps VoiceOver from announcing the whole screen as one
 * giant button — without it the wrapper swallows every child element into a
 * single accessibility node.
 *
 * ScrollView-based screens don't need this: KeyboardAwareScreen already sets
 * keyboardShouldPersistTaps="handled" (background taps dismiss, buttons still
 * fire) and keyboardDismissMode="interactive" (drag the keyboard away). Use
 * this for the ones that aren't scroll views — modal sheets, mostly.
 */
export function DismissKeyboard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      <View style={[styles.fill, style]}>{children}</View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

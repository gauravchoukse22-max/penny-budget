import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { tapLight } from '../lib/haptics';

type Props = PressableProps & {
  /** How far to shrink while pressed. 0.96 by default. */
  activeScale?: number;
  /** Fire a light haptic on press-in. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Layout for the CONTENT inside the touch box. The inner view defaults to a
   * centred row, which silently re-laid-out any button whose children were
   * stacked — the add-transaction category grid rendered its icon BESIDE its
   * label, overflowing 72pt items into each other. Pass the content's own
   * layout here when it isn't a row.
   */
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * A Pressable that springs down slightly while held — the small physical cue
 * that makes taps feel responsive.
 *
 * `style` goes on the Pressable itself, NOT on the Animated.View inside it.
 * Styling the inner view instead leaves the touch target the size of whatever
 * the children happen to measure, while padding, minHeight and flex — the
 * things that make a button big enough to hit — apply to a view that receives
 * no touches. The button then looks correct and misses most taps, which is
 * indistinguishable from a dead control.
 *
 * The Animated.View carries only the transform, so it scales the content
 * inside an unchanged box.
 */
export function PressableScale({ activeScale = 0.96, haptic = false, style, contentStyle, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (value: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver: true, friction: 7, tension: 180 }).start();

  return (
    <Pressable
      style={style}
      onPressIn={(e) => {
        springTo(activeScale);
        if (haptic) tapLight();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        springTo(1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[styles.inner, contentStyle, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Inherits the parent's row/centre alignment so moving `style` outward doesn't
// re-stack children that were laid out side by side.
const styles = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});

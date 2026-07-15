import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { tapLight } from '../lib/haptics';

type Props = PressableProps & {
  /** How far to shrink while pressed. 0.96 by default. */
  activeScale?: number;
  /** Fire a light haptic on press-in. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * A Pressable that springs down slightly while held — the small physical cue
 * that makes taps feel responsive. Wraps children in an Animated.View so the
 * scale never fights layout.
 */
export function PressableScale({ activeScale = 0.96, haptic = false, style, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (value: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver: true, friction: 7, tension: 180 }).start();

  return (
    <Pressable
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
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

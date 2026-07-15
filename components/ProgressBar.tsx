import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../theme/colors';
import type { BudgetStatus } from '../lib/models';

export function ProgressBar({ percent, status, height = 7 }: { percent: number; status: BudgetStatus; height?: number }) {
  const theme = useTheme();
  const color = status === 'red' ? theme.systemRed : status === 'amber' ? theme.systemAmber : theme.systemGreen;
  const clamped = Math.min(100, Math.max(0, percent));

  // Spring the fill toward its target width instead of snapping. Animated can
  // interpolate a 0..1 driver into a `%` width string, which keeps the bar
  // responsive to layout without measuring.
  const progress = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    Animated.spring(progress, {
      toValue: clamped,
      useNativeDriver: false,
      friction: 9,
      tension: 70,
    }).start();
  }, [clamped, progress]);

  const width = progress.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.fieldBackground }]}>
      <Animated.View style={[styles.fill, { width, height, borderRadius: height / 2, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {},
});

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/colors';
import type { BudgetStatus } from '../lib/models';

export function ProgressBar({ percent, status, height = 7 }: { percent: number; status: BudgetStatus; height?: number }) {
  const theme = useTheme();
  const color = status === 'red' ? theme.systemRed : status === 'amber' ? theme.systemAmber : theme.systemGreen;
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.fieldBackground }]}>
      <View style={[styles.fill, { width: `${clamped}%`, height, borderRadius: height / 2, backgroundColor: color }]} />
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

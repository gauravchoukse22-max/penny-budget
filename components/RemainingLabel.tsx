import React from 'react';
import { Text, TextStyle } from 'react-native';
import { useTheme } from '../theme/colors';
import { formatCurrency } from '../lib/format';

/** "$150 left" (green) or "$45 over" (red) for a budgeted category. */
export function RemainingLabel({
  remaining,
  currency,
  size = 12,
  style,
}: {
  remaining: number;
  currency: string;
  size?: number;
  style?: TextStyle;
}) {
  const theme = useTheme();
  const over = remaining < 0;
  return (
    <Text style={[{ fontSize: size, fontWeight: '700', color: over ? theme.systemRed : theme.systemGreen }, style]}>
      {over ? `${formatCurrency(Math.abs(remaining), currency)} over` : `${formatCurrency(remaining, currency)} left`}
    </Text>
  );
}

import React from 'react';
import { Text, TextStyle } from 'react-native';
import { useTheme } from '../theme/colors';
import { formatCurrency, maskedAmount } from '../lib/format';
import { useBudget } from '../context/BudgetContext';

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
  const { settings } = useBudget();
  const over = remaining < 0;
  const value = settings.hideAmounts ? maskedAmount(currency) : formatCurrency(Math.abs(remaining), currency);
  return (
    <Text style={[{ fontSize: size, fontWeight: '700', color: over ? theme.systemRed : theme.systemGreen }, style]}>
      {over ? `${value} over` : `${value} left`}
    </Text>
  );
}

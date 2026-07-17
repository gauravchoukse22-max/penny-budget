import React from 'react';
import { Text, TextStyle, Platform } from 'react-native';
import { useTheme } from '../theme/colors';
import { formatCurrency, maskedAmount } from '../lib/format';
import { useBudget } from '../context/BudgetContext';

type Props = {
  amount: number;
  currency?: string;
  size?: number;
  weight?: 'regular' | 'semibold' | 'bold';
  color?: string;
  style?: TextStyle;
};

export function AmountText({ amount, currency = 'USD', size = 17, weight = 'regular', color, style }: Props) {
  const theme = useTheme();
  const { settings } = useBudget();
  const fontWeight = weight === 'bold' ? '700' : weight === 'semibold' ? '600' : '400';
  return (
    <Text
      style={[
        {
          fontSize: size,
          fontWeight,
          color: color ?? theme.label,
          fontVariant: ['tabular-nums'],
          fontFamily: Platform.select({ ios: 'System', default: undefined }),
        },
        style,
      ]}
    >
      {settings.hideAmounts ? maskedAmount(currency) : formatCurrency(amount, currency)}
    </Text>
  );
}

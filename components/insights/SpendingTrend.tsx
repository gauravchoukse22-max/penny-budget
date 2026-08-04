import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { LineChart } from '../charts/LineChart';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing } from '../../theme/colors';
import { computeTrendSeries } from '../../lib/queries';
import type { TrendPoint } from '../../lib/models';

/** The 6-month spend line, ending at the selected month, with a footer that
 * says how this month compares to the 6-month average — the number the chart
 * exists to answer. */
export function SpendingTrend() {
  const theme = useTheme();
  const { selectedMonth, surplus } = useBudget();
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  useEffect(() => {
    let alive = true;
    computeTrendSeries(selectedMonth, 6).then((t) => alive && setTrend(t));
    return () => {
      alive = false;
    };
  }, [selectedMonth]);

  const values = trend.map((t) => t.totalSpend);
  if (values.every((v) => v === 0)) return null;

  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const deltaPct = avg > 0 ? ((surplus.spend - avg) / avg) * 100 : null;

  return (
    <Surface>
      <SectionLabel title="Spending Trend" right="6 Months" />
      <View style={{ marginTop: spacing.sm }}>
        <LineChart points={trend.map((t) => ({ yearMonth: t.yearMonth, value: t.totalSpend }))} height={150} color={theme.accent} />
      </View>
      {deltaPct !== null && (
        <Text
          style={[
            styles.footer,
            // Spending above your own average is the "look closer" direction.
            { color: deltaPct >= 0 ? theme.negativeMuted : theme.positiveMuted, borderTopColor: theme.separator },
          ]}
        >
          This month is {Math.abs(Math.round(deltaPct))}% {deltaPct >= 0 ? 'above' : 'below'} your 6-month average.
        </Text>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  footer: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

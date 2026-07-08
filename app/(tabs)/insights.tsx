import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { LineChart } from '../../components/charts/LineChart';
import { DonutChart } from '../../components/charts/DonutChart';
import { BarChart } from '../../components/charts/BarChart';
import { computeTrendSeries } from '../../lib/queries';
import type { TrendPoint } from '../../lib/models';
import { formatMonthLabel } from '../../lib/format';

export default function InsightsScreen() {
  const theme = useTheme();
  const { selectedMonth, categorySummaries, cardTotals, cards, settings } = useBudget();
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  useEffect(() => {
    computeTrendSeries(selectedMonth, 6).then(setTrend);
  }, [selectedMonth]);

  const donutSlices = categorySummaries
    .filter((s) => s.spend > 0)
    .map((s) => ({ label: s.category.name, value: s.spend, color: s.category.color }));

  const budgetVsActualGroups = categorySummaries.map((s) => ({
    label: s.category.name.slice(0, 4),
    values: [
      { value: s.category.monthlyLimit, color: theme.tertiaryLabel },
      { value: s.spend, color: s.category.color },
    ],
  }));

  const cardUsageSlices = cards
    .map((c) => ({ label: c.name, value: cardTotals.get(c.id) ?? 0, color: c.color }))
    .filter((s) => s.value > 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[type.title1, { color: theme.label }]}>Insights</Text>
        <Text style={{ color: theme.secondaryLabel, marginTop: -12 }}>{formatMonthLabel(selectedMonth)}</Text>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Spend Trend (6 months)</Text>
          <LineChart points={trend.map((t) => ({ yearMonth: t.yearMonth, value: t.totalSpend }))} />
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Category Breakdown</Text>
          <DonutChart slices={donutSlices} />
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Budget vs. Actual</Text>
          <BarChart groups={budgetVsActualGroups} />
          <View style={styles.legendRow}>
            <LegendDot color={theme.tertiaryLabel} label="Ideal" />
            <LegendDot color={theme.accent} label="Actual" />
          </View>
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Card Usage</Text>
          <DonutChart slices={cardUsageSlices} />
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Surplus History</Text>
          <LineChart points={trend.map((t) => ({ yearMonth: t.yearMonth, value: t.surplus }))} color={theme.systemGreen} />
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  legendRow: { flexDirection: 'row', gap: 16, marginTop: 10, justifyContent: 'center' },
});

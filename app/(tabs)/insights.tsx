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
import { SmartForecastCard, AnomalyAlertBanner, MonthlySummaryCard } from '../../components/FeatureCards';
import { getHistoricalCategoryProjections, detectAnomalies } from '../../features/predictive-engine';
import { generateMonthlySummary } from '../../features/streaks-and-gamification';
import type { CategoryProjection, AnomalyAlert, MonthlySummary } from '../../features/models';

export default function InsightsScreen() {
  const theme = useTheme();
  const { selectedMonth, categories, categorySummaries, cardTotals, cards, settings } = useBudget();
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [projections, setProjections] = useState<CategoryProjection[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    computeTrendSeries(selectedMonth, 6).then(setTrend);
    getHistoricalCategoryProjections(3).then(setProjections);
    detectAnomalies(selectedMonth).then(setAnomalies);
    generateMonthlySummary(selectedMonth).then(setSummary);
    setDismissed(new Set());
  }, [selectedMonth]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const projectionCards = projections
    .filter((p) => p.budgetLimit > 0)
    .map((p) => {
      const cat = categoryById.get(p.categoryId);
      return {
        categoryName: cat?.name ?? 'Category',
        categoryColor: cat?.color ?? theme.accent,
        currentSpend: p.currentSpend,
        projectedSpend: p.projectedFinalSpend,
        budgetLimit: p.budgetLimit,
        status: p.status,
      };
    });
  const visibleAnomalies = anomalies.filter((a) => !dismissed.has(a.transactionId));

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

        {visibleAnomalies.map((a) => (
          <AnomalyAlertBanner
            key={a.transactionId}
            explanation={a.explanation}
            severity={a.severity}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(a.transactionId))}
          />
        ))}

        {summary && summary.transactionCount > 0 && (
          <MonthlySummaryCard
            summary={{
              totalSpent: summary.totalSpent,
              transactionCount: summary.transactionCount,
              topCategoryName: summary.topCategories[0]?.name,
              topCategoryAmount: summary.topCategories[0]?.total,
              biggestNote: summary.biggestPurchase?.note ?? undefined,
              biggestAmount: summary.biggestPurchase?.amount,
              budgetScore: summary.budgetScore,
            }}
            currency={settings.currency}
          />
        )}

        {projectionCards.length > 0 && <SmartForecastCard projections={projectionCards} currency={settings.currency} />}

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

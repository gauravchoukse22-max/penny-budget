import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type as typeScale, hexToRgba } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { AmountText } from '../../components/AmountText';
import { LineChart } from '../../components/charts/LineChart';
import { computeTrendSeries, computeCategoryMovers } from '../../lib/queries';
import { currentYearMonth } from '../../lib/db';
import type { TrendPoint, CategoryMover } from '../../lib/models';
import { formatMonthLabel } from '../../lib/format';
import { getHistoricalCategoryProjections, detectAnomalies } from '../../features/predictive-engine';
import { generateMonthlySummary } from '../../features/streaks-and-gamification';
import type { CategoryProjection, AnomalyAlert, MonthlySummary } from '../../features/models';

export default function InsightsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { selectedMonth, categories, categorySummaries, cardTotals, cards, settings, surplus } = useBudget();
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [movers, setMovers] = useState<CategoryMover[]>([]);
  const [projections, setProjections] = useState<CategoryProjection[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // The forecast projects the rest of the *current* month from spend-to-date;
  // it's meaningless for a past or future month, so only compute it when the
  // selected month is the live one.
  const isCurrentMonth = selectedMonth === currentYearMonth();

  useEffect(() => {
    computeTrendSeries(selectedMonth, 6).then(setTrend);
    computeCategoryMovers(selectedMonth).then(setMovers);
    if (isCurrentMonth) getHistoricalCategoryProjections(3).then(setProjections);
    else setProjections([]);
    detectAnomalies(selectedMonth).then(setAnomalies);
    generateMonthlySummary(selectedMonth).then(setSummary);
    setDismissed(new Set());
  }, [selectedMonth, isCurrentMonth]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // ── Cash flow + savings rate (the headline numbers) ──────────────────────
  const income = surplus.salary;
  const spent = surplus.spend;
  const net = income - spent;
  const hasIncome = income > 0;
  const savingsRate = hasIncome ? Math.round((net / income) * 100) : null;
  const netColor = !hasIncome ? theme.label : net >= 0 ? theme.positiveMuted : theme.negativeMuted;

  // ── Spend trend delta vs 6-month average ─────────────────────────────────
  const trendValues = trend.map((t) => t.totalSpend);
  const trendAvg = trendValues.length ? trendValues.reduce((a, b) => a + b, 0) / trendValues.length : 0;
  const trendDeltaPct = trendAvg > 0 ? ((spent - trendAvg) / trendAvg) * 100 : null;

  // ── Biggest month-over-month movers ──────────────────────────────────────
  const topMovers = movers.filter((m) => Math.abs(m.delta) >= 1).slice(0, 4);

  // ── Where the money goes (ranked spend, folds in budget vs actual) ───────
  const breakdown = categorySummaries.filter((s) => s.spend > 0);
  const breakdownTotal = breakdown.reduce((sum, s) => sum + s.spend, 0);
  const maxCategorySpend = Math.max(...breakdown.map((s) => s.spend), 1);

  // ── Month-end outlook (reframed forecast) ────────────────────────────────
  const outlook = projections
    .filter((p) => p.budgetLimit > 0)
    .map((p) => ({
      name: categoryById.get(p.categoryId)?.name ?? 'Category',
      projected: p.projectedFinalSpend,
      limit: p.budgetLimit,
      status: p.status,
    }));
  const outlookConcerns = outlook.filter((o) => o.status !== 'on_track');

  // ── By-card totals (folds in the old card-usage donut) ───────────────────
  const byCard = cards
    .map((c) => ({ name: c.name, total: cardTotals.get(c.id) ?? 0 }))
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total);

  const visibleAnomalies = anomalies.filter((a) => !dismissed.has(a.transactionId));
  const hasAnyData = spent > 0 || income > 0 || breakdown.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={[typeScale.title1, { color: theme.label }]}>Insights</Text>
          <Text style={{ color: theme.secondaryLabel, marginTop: 2 }}>{formatMonthLabel(selectedMonth)}</Text>
        </View>

        {visibleAnomalies.map((a) => (
          <NoticeRow
            key={a.transactionId}
            text={a.explanation}
            critical={a.severity === 'critical'}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(a.transactionId))}
          />
        ))}

        {!hasAnyData && (
          <Surface>
            <View style={styles.emptyState}>
              <Ionicons name="sparkles-outline" size={26} color={theme.tertiaryLabel} />
              <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>
                Log some spending to see your cash flow, trends and category movers here.
              </Text>
            </View>
          </Surface>
        )}

        {/* Cash flow */}
        <Surface>
          <SectionLabel title="Cash Flow" />
          <View style={styles.netRow}>
            <Text style={[styles.netSign, { color: netColor }]}>{net >= 0 ? '+' : '−'}</Text>
            <AmountText amount={Math.abs(net)} currency={settings.currency} size={40} weight="semibold" color={netColor} />
          </View>
          <Text style={[styles.netCaption, { color: theme.tertiaryLabel }]}>
            {hasIncome ? 'Income minus spending this month' : 'Spending this month — set income to see net cash flow'}
          </Text>

          <View style={[styles.divider, { backgroundColor: theme.separator }]} />

          <View style={styles.statTrio}>
            <StatCell label="Income">
              <AmountText amount={income} currency={settings.currency} size={16} weight="semibold" color={theme.label} />
            </StatCell>
            <View style={[styles.trioSep, { backgroundColor: theme.separator }]} />
            <StatCell label="Spent">
              <AmountText amount={spent} currency={settings.currency} size={16} weight="semibold" color={theme.label} />
            </StatCell>
            <View style={[styles.trioSep, { backgroundColor: theme.separator }]} />
            <StatCell label="Savings Rate">
              <Text
                style={[
                  styles.trioValue,
                  { color: savingsRate === null ? theme.tertiaryLabel : savingsRate >= 0 ? theme.positiveMuted : theme.negativeMuted },
                ]}
              >
                {savingsRate === null ? '—' : `${savingsRate}%`}
              </Text>
            </StatCell>
          </View>
        </Surface>

        {/* Spend trend */}
        <Surface>
          <SectionLabel title="Spend Trend" right="6 Months" />
          <View style={{ marginTop: spacing.sm }}>
            <LineChart points={trend.map((t) => ({ yearMonth: t.yearMonth, value: t.totalSpend }))} color={theme.label} />
          </View>
          <View style={[styles.trendFooter, { borderTopColor: theme.separator }]}>
            <View>
              <Text style={[styles.microLabel, { color: theme.tertiaryLabel }]}>6-MO AVG</Text>
              <AmountText amount={trendAvg} currency={settings.currency} size={15} weight="semibold" color={theme.secondaryLabel} />
            </View>
            {trendDeltaPct !== null && <DeltaTag pct={trendDeltaPct} theme={theme} label="vs avg" />}
          </View>
        </Surface>

        {/* Category movers */}
        {topMovers.length > 0 && (
          <Surface>
            <SectionLabel title="Biggest Changes" right="vs Last Month" />
            <View style={{ marginTop: spacing.xs }}>
              {topMovers.map((m, i) => (
                <View
                  key={m.category.id}
                  style={[styles.moverRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
                >
                  <Text style={[styles.moverName, { color: theme.label }]} numberOfLines={1}>
                    {m.category.name}
                  </Text>
                  <View style={styles.moverRight}>
                    <AmountText amount={m.current} currency={settings.currency} size={14} color={theme.secondaryLabel} />
                    {m.percentChange === null ? (
                      <Text style={[styles.newTag, { color: theme.tertiaryLabel }]}>NEW</Text>
                    ) : (
                      <DeltaTag pct={m.percentChange} theme={theme} compact />
                    )}
                  </View>
                </View>
              ))}
            </View>
          </Surface>
        )}

        {/* Where it goes */}
        {breakdown.length > 0 && (
          <Surface>
            <SectionLabel title="Where It Goes" />
            <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
              {breakdown.map((s) => {
                const over = s.status === 'red';
                const share = breakdownTotal > 0 ? Math.round((s.spend / breakdownTotal) * 100) : 0;
                return (
                  <Pressable key={s.category.id} onPress={() => router.push(`/category/${s.category.id}`)}>
                    <View style={styles.breakdownTop}>
                      <Text style={[styles.breakdownName, { color: theme.label }]} numberOfLines={1}>
                        {s.category.name}
                      </Text>
                      <View style={styles.breakdownAmt}>
                        {over && <Text style={[styles.overTag, { color: theme.negativeMuted }]}>OVER</Text>}
                        <AmountText amount={s.spend} currency={settings.currency} size={14} weight="semibold" color={theme.label} />
                        <Text style={[styles.sharePct, { color: theme.tertiaryLabel }]}>{share}%</Text>
                      </View>
                    </View>
                    <View style={[styles.track, { backgroundColor: theme.neutralTrack }]}>
                      <View
                        style={{
                          width: `${Math.max(3, (s.spend / maxCategorySpend) * 100)}%`,
                          height: '100%',
                          borderRadius: radius.pill,
                          backgroundColor: over ? theme.negativeMuted : hexToRgba(theme.label, 0.55),
                        }}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Surface>
        )}

        {/* Month-end outlook (current month only) */}
        {isCurrentMonth && outlook.length > 0 && (
          <Surface>
            <SectionLabel title="Month-End Outlook" />
            {outlookConcerns.length === 0 ? (
              <Text style={[styles.outlookClear, { color: theme.positiveMuted }]}>
                Every budgeted category is pacing within its limit.
              </Text>
            ) : (
              <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
                {outlookConcerns.map((o, i) => {
                  const over = o.status === 'over_budget';
                  return (
                    <View key={i}>
                      <View style={styles.breakdownTop}>
                        <Text style={[styles.breakdownName, { color: theme.label }]} numberOfLines={1}>
                          {o.name}
                        </Text>
                        <Text style={[styles.outlookStatus, { color: over ? theme.negativeMuted : theme.secondaryLabel }]}>
                          {over ? 'Trending over' : 'Running high'}
                        </Text>
                      </View>
                      <View style={[styles.track, { backgroundColor: theme.neutralTrack }]}>
                        <View
                          style={{
                            width: `${Math.min(100, (o.projected / o.limit) * 100)}%`,
                            height: '100%',
                            borderRadius: radius.pill,
                            backgroundColor: over ? theme.negativeMuted : hexToRgba(theme.label, 0.45),
                          }}
                        />
                      </View>
                      <View style={styles.outlookCaptionRow}>
                        <Text style={[styles.outlookCaption, { color: theme.tertiaryLabel }]}>Pacing to </Text>
                        <AmountText amount={o.projected} currency={settings.currency} size={12} color={theme.tertiaryLabel} />
                        <Text style={[styles.outlookCaption, { color: theme.tertiaryLabel }]}> of </Text>
                        <AmountText amount={o.limit} currency={settings.currency} size={12} color={theme.tertiaryLabel} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Surface>
        )}

        {/* This month */}
        {summary && summary.transactionCount > 0 && (
          <Surface>
            <SectionLabel title="This Month" />
            <View style={{ marginTop: spacing.xs }}>
              <MetaRow label="Transactions" theme={theme}>
                <Text style={[styles.metaValue, { color: theme.label }]}>{summary.transactionCount}</Text>
              </MetaRow>
              {summary.biggestPurchase && (
                <MetaRow label={summary.biggestPurchase.note || 'Biggest purchase'} theme={theme}>
                  <AmountText amount={summary.biggestPurchase.amount} currency={settings.currency} size={15} weight="semibold" color={theme.label} />
                </MetaRow>
              )}
              <MetaRow label="On budget" theme={theme} last={byCard.length === 0}>
                <Text style={[styles.metaValue, { color: theme.label }]}>{summary.budgetScore}%</Text>
              </MetaRow>

              {byCard.length > 0 && (
                <>
                  <Text style={[styles.microLabel, { color: theme.tertiaryLabel, marginTop: spacing.md, marginBottom: spacing.xs }]}>BY CARD</Text>
                  {byCard.map((c, i) => (
                    <MetaRow key={i} label={c.name} theme={theme} last={i === byCard.length - 1}>
                      <AmountText amount={c.total} currency={settings.currency} size={14} color={theme.secondaryLabel} />
                    </MetaRow>
                  ))}
                </>
              )}
            </View>
          </Surface>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Small building blocks ──────────────────────────────────────────────────

function SectionLabel({ title, right }: { title: string; right?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={[styles.sectionLabel, { color: theme.secondaryLabel }]}>{title.toUpperCase()}</Text>
      {right && <Text style={[styles.sectionRight, { color: theme.tertiaryLabel }]}>{right.toUpperCase()}</Text>}
    </View>
  );
}

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.statCell}>
      <Text style={[styles.microLabel, { color: theme.tertiaryLabel, marginBottom: 4 }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function MetaRow({ label, children, theme, last }: { label: string; children: React.ReactNode; theme: ReturnType<typeof useTheme>; last?: boolean }) {
  return (
    <View style={[styles.metaRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }]}>
      <Text style={[styles.metaLabel, { color: theme.secondaryLabel }]} numberOfLines={1}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function DeltaTag({ pct, theme, label, compact }: { pct: number; theme: ReturnType<typeof useTheme>; label?: string; compact?: boolean }) {
  // Spending up is the "bad" direction, so up = muted red, down = muted green.
  const up = pct >= 0;
  const color = up ? theme.negativeMuted : theme.positiveMuted;
  return (
    <View style={styles.deltaRow}>
      <Text style={[styles.deltaText, { color }]}>
        {up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%
      </Text>
      {label && !compact && <Text style={[styles.deltaLabel, { color: theme.tertiaryLabel }]}>{label}</Text>}
    </View>
  );
}

function NoticeRow({ text, critical, onDismiss }: { text: string; critical: boolean; onDismiss: () => void }) {
  const theme = useTheme();
  const accent = critical ? theme.negativeMuted : theme.secondaryLabel;
  return (
    <View style={[styles.notice, { backgroundColor: theme.card, borderColor: theme.separator }]}>
      <View style={[styles.noticeBar, { backgroundColor: accent }]} />
      <Text style={[styles.noticeText, { color: theme.secondaryLabel }]} numberOfLines={3}>
        {text}
      </Text>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Ionicons name="close" size={16} color={theme.tertiaryLabel} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },

  sectionLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  sectionRight: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
  microLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  netRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 4 },
  netSign: { fontSize: 30, fontWeight: '500', marginRight: 2 },
  netCaption: { fontSize: 12, marginTop: 2 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.lg },
  statTrio: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1 },
  trioSep: { width: StyleSheet.hairlineWidth, height: 30, marginHorizontal: spacing.md },
  trioValue: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  trendFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deltaText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  deltaLabel: { fontSize: 11 },

  moverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  moverName: { flex: 1, fontSize: 15, marginRight: spacing.md },
  moverRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  newTag: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  breakdownTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  breakdownName: { flex: 1, fontSize: 15, marginRight: spacing.md },
  breakdownAmt: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sharePct: { fontSize: 12, width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  overTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },

  outlookClear: { fontSize: 14, marginTop: spacing.sm, lineHeight: 20 },
  outlookStatus: { fontSize: 12, fontWeight: '600' },
  outlookCaptionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  outlookCaption: { fontSize: 12 },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  metaLabel: { flex: 1, fontSize: 15, marginRight: spacing.md },
  metaValue: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  noticeBar: { width: 3, alignSelf: 'stretch', borderRadius: radius.pill },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },

  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
});

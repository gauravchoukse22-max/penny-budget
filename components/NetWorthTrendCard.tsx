import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Surface } from './Surface';
import { Chip } from './Button';
import { AmountText } from './AmountText';
import { NetWorthTrendChart } from './NetWorthTrendChart';
import { useTheme, spacing, type } from '../theme/colors';
import {
  buildNetWorthSeries,
  monthKeyFromDate,
  formatMonthYear,
  type NetWorthSnapshot,
} from '../lib/net-worth-history';

// The headline view in Monarch and Copilot is the net-worth line, and this is
// this app's version of it — with one difference it has to be honest about.
// Those apps read daily balances from a bank feed and can draw a line back
// through years the user never opened the app. Here every figure was typed in
// by hand, and nothing recorded it before the first snapshot, so the line
// starts from the first month a balance was saved and no earlier. The two
// states below exist to say that in words rather than fake a chart.
//
// Rendering lives here rather than in app/net-worth/index.tsx to keep that
// screen about the asset and liability lists; the parent only supplies rows.

type RangeKey = '6m' | '12m' | 'all';

const RANGES: { key: RangeKey; label: string; months: number | null }[] = [
  { key: '6m', label: '6M', months: 6 },
  { key: '12m', label: '1Y', months: 12 },
  { key: 'all', label: 'All', months: null },
];

export function NetWorthTrendCard({
  snapshots,
  currency,
  /** Whether the user has any assets or liabilities at all. Separates "brand
   * new, nothing to track" from "has balances, but no history recorded yet" —
   * the second is what every existing install sees on first launch after this
   * feature ships, and it needs an explanation rather than silence. */
  hasEntries,
}: {
  snapshots: NetWorthSnapshot[];
  currency: string;
  hasEntries: boolean;
}) {
  const theme = useTheme();
  const [range, setRange] = useState<RangeKey>('12m');

  const thisMonth = monthKeyFromDate(new Date());
  // Built twice on purpose: the unwindowed pass is what decides whether a range
  // switcher is worth showing at all, and it is a handful of array operations
  // over at most a few dozen rows.
  const full = useMemo(() => buildNetWorthSeries(snapshots, thisMonth, null), [snapshots, thisMonth]);
  const months = RANGES.find((r) => r.key === range)?.months ?? null;
  const series = useMemo(
    () => buildNetWorthSeries(snapshots, thisMonth, months),
    [snapshots, thisMonth, months]
  );

  // Nothing owned, nothing owed, no history — the screen's own empty copy
  // already covers this, and a second empty card under it is just noise.
  if (series.status === 'empty' && !hasEntries) return null;

  const header = (
    <View style={styles.header}>
      <Text style={[type.headline, { color: theme.label }]}>Trend</Text>
      {series.status === 'ready' && full.points.length > 6 ? (
        <View style={styles.chips}>
          {RANGES.map((r) => (
            <Chip
              key={r.key}
              label={r.label}
              size="sm"
              selected={r.key === range}
              onPress={() => setRange(r.key)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  if (series.status !== 'ready') {
    return (
      <Surface>
        {header}
        <View style={styles.noticeRow}>
          <Ionicons name="trending-up-outline" size={18} color={theme.tertiaryLabel} />
          <Text style={[styles.notice, { color: theme.secondaryLabel }]}>
            {series.status === 'empty'
              ? 'No history yet. Nothing was recording your balances before now, and Penny will not invent months it has no figures for. Update any balance and the line starts from there.'
              : `One month recorded so far (${formatMonthYear(series.points[0].yearMonth)}). A trend needs a second month — it starts building from here, not backwards through months Penny never saw.`}
          </Text>
        </View>
      </Surface>
    );
  }

  const change = series.change;
  const up = (change?.amount ?? 0) > 0;
  const flat = (change?.amount ?? 0) === 0;
  const changeColor = flat ? theme.secondaryLabel : up ? theme.positiveMuted : theme.negativeMuted;
  const carried = series.points.filter((p) => p.filled).length;

  return (
    <Surface>
      {header}

      {change ? (
        <View style={styles.changeRow}>
          <Ionicons
            name={flat ? 'remove' : up ? 'arrow-up' : 'arrow-down'}
            size={16}
            color={changeColor}
          />
          <AmountText
            amount={Math.abs(change.amount)}
            currency={currency}
            size={17}
            weight="semibold"
            color={changeColor}
          />
          {change.percent !== null ? (
            <Text style={{ color: changeColor, fontSize: 13, fontWeight: '600' }}>
              {change.percent > 0 ? '+' : ''}
              {change.percent}%
            </Text>
          ) : null}
          <Text style={{ color: theme.tertiaryLabel, fontSize: 12, flex: 1 }} numberOfLines={1}>
            {series.rangeLabel}
          </Text>
        </View>
      ) : null}

      <NetWorthTrendChart points={series.points} />

      {carried > 0 ? (
        <Text style={[styles.footnote, { color: theme.tertiaryLabel }]}>
          Hollow points are months with no balance update — the previous figure
          carried forward, not a new reading.
        </Text>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  chips: { flexDirection: 'row', gap: 6 },
  noticeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingVertical: 4 },
  notice: { flex: 1, fontSize: 13, lineHeight: 19 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  footnote: { fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
});

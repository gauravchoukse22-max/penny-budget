import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Circle, Line } from 'react-native-svg';
import { useTheme } from '../theme/colors';
import {
  formatMonthShort,
  netWorthChartDomain,
  type NetWorthPoint,
} from '../lib/net-worth-history';

// The net-worth trend line.
//
// Built on react-native-svg, which is already a dependency (components/charts/
// LineChart.tsx uses it) — no new package, so no native rebuild.
//
// ── Why not just reuse LineChart ────────────────────────────────────────────
// It was the first thing tried. Two things make it the wrong chart here, and
// both are correct behaviour for what it was built for:
//
//  1. It pins the axis to zero (`Math.min(...values, 0)`). A spending category
//     has a real floor at zero, so that is right there. Net worth does not: a
//     balance moving between $124k and $127k renders as a dead-flat line
//     hugging the top of a chart that is otherwise empty, and the $3,000 gain
//     — the whole point of the view — becomes invisible.
//  2. It prints a month label under every point. At 12 points those overlap
//     into mush; this one labels the ends and lets the value do the talking.
//
// ── Filled points ──────────────────────────────────────────────────────────
// A month with no balance edit carries the previous figure forward (see
// lib/net-worth-history.ts). Those are drawn hollow, so a glance separates the
// months the user confirmed from the months the app is assuming were flat.
// Solid = you told us this. Hollow = nothing changed as far as we know.

const WIDTH = 320;
const PADDING = 16;

export function NetWorthTrendChart({
  points,
  height = 170,
}: {
  points: NetWorthPoint[];
  height?: number;
}) {
  const theme = useTheme();

  if (points.length < 2) return null;

  const { min, max } = netWorthChartDomain(points);
  const range = max - min || 1;
  const chartWidth = WIDTH - PADDING * 2;
  const chartHeight = height - PADDING * 2;

  const coords = points.map((p, i) => ({
    x: PADDING + (i / (points.length - 1)) * chartWidth,
    y: PADDING + chartHeight - ((p.value - min) / range) * chartHeight,
    filled: p.filled,
  }));

  // Direction colours the line, using the muted semantic pair rather than the
  // system hues — this sits inside a card, and a full-strength red reads as an
  // error rather than as a downward month.
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const stroke =
    last > first ? theme.positiveMuted : last < first ? theme.negativeMuted : theme.accent;

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  // The area wash is the same polyline closed along the bottom edge. Polygon
  // rather than Path so there is no d-string to get subtly wrong.
  const area = `${PADDING},${PADDING + chartHeight} ${polyline} ${PADDING + chartWidth},${PADDING + chartHeight}`;

  // Zero only gets a rule when the series actually crosses it — someone whose
  // net worth is climbing out of debt needs to see where the line breaks even,
  // and everyone else would just get a stray line at the edge of the chart.
  const crossesZero = min < 0 && max > 0;
  const zeroY = PADDING + chartHeight - ((0 - min) / range) * chartHeight;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Net worth trend, ${points.length} months, ${
        last > first ? 'up' : last < first ? 'down' : 'unchanged'
      } over the period`}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        {crossesZero ? (
          <Line
            x1={PADDING}
            y1={zeroY}
            x2={WIDTH - PADDING}
            y2={zeroY}
            stroke={theme.separator}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ) : null}
        <Polygon points={area} fill={stroke} fillOpacity={0.12} />
        <Polyline
          points={polyline}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c, i) =>
          c.filled ? (
            <Circle key={i} cx={c.x} cy={c.y} r={3} fill={theme.card} stroke={stroke} strokeWidth={1.5} />
          ) : (
            <Circle key={i} cx={c.x} cy={c.y} r={3.5} fill={stroke} />
          )
        )}
      </Svg>
      <View style={styles.axis}>
        <Text style={[styles.axisLabel, { color: theme.tertiaryLabel }]}>
          {formatMonthShort(points[0].yearMonth)}
        </Text>
        <Text style={[styles.axisLabel, { color: theme.tertiaryLabel }]}>
          {formatMonthShort(points[points.length - 1].yearMonth)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 2 },
  axisLabel: { fontSize: 11 },
});

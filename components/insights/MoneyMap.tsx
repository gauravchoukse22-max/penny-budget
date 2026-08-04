import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing } from '../../theme/colors';
import { formatCurrency, maskedAmount } from '../../lib/format';

/**
 * A simple Sankey-style money map: income on the left, flowing into the top
 * spending categories plus Saved and Left over on the right.
 *
 * Drawn with react-native-svg (already a dependency — LineChart uses it), NOT a
 * chart library: a real Sankey layout engine solves node ordering and link
 * crossing for arbitrary graphs, and this graph is one source fanning out to at
 * most eight sinks in a fixed order. Two bezier edges per ribbon is the whole
 * layout problem.
 */

type Flow = { label: string; amount: number; color: string; muted?: boolean };

const VIEW_W = 320;
const LEFT_X = 10; // left bar
const BAR_W = 8;
const RIGHT_X = 196; // right node bar
const NODE_W = 5;
const LABEL_X = RIGHT_X + NODE_W + 9;
const NODE_GAP = 7;
const MIN_NODE_H = 26; // two lines of svg text
const BASE_H = 190; // proportional budget before minimums pad it out

export function MoneyMap() {
  const theme = useTheme();
  const { surplus, categorySummaries, settings } = useBudget();

  const money = (v: number) => (settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(v, settings.currency));

  // ── Build the flows: top categories, then the tail as one group ──────────
  const spending = categorySummaries.filter((s) => s.spend > 0).sort((a, b) => b.spend - a.spend);
  // 5 named categories + "Everything else" + Saved + Left over = 8 flows max.
  // Beyond that the ribbons thin into unreadable threads — grouping the tail
  // keeps every ribbon wide enough to mean something.
  const named = spending.slice(0, 5);
  const tail = spending.slice(5).reduce((sum, s) => sum + s.spend, 0);

  const flows: Flow[] = named.map((s) => ({ label: s.category.name, amount: s.spend, color: s.category.color }));
  if (tail > 0) flows.push({ label: 'Everything else', amount: tail, color: '#8E8E93', muted: true });
  if (surplus.savings > 0) flows.push({ label: 'Saved', amount: surplus.savings, color: theme.systemGreen });
  const leftover = Math.max(0, surplus.surplus);
  if (leftover > 0 && surplus.salary > 0) flows.push({ label: 'Left over', amount: leftover, color: theme.accent });

  const total = flows.reduce((sum, f) => sum + f.amount, 0);
  if (total <= 0) return null; // nothing to map — the card simply isn't there

  // ── Layout: node heights proportional to amount, floored for label room ──
  const heights = flows.map((f) => Math.max(MIN_NODE_H, (f.amount / total) * BASE_H));
  const svgH = heights.reduce((a, b) => a + b, 0) + NODE_GAP * (flows.length - 1);

  // The left bar stacks the SAME heights contiguously (no gaps) so each ribbon
  // leaves the bar exactly as wide as it arrives — centered vertically so the
  // fan spreads symmetrically instead of drooping.
  const leftTotalH = heights.reduce((a, b) => a + b, 0);
  let leftY = (svgH - leftTotalH) / 2;
  let rightY = 0;
  const midX = (LEFT_X + BAR_W + RIGHT_X) / 2;

  const nodes = flows.map((f, i) => {
    const h = heights[i];
    const seg = { flow: f, ly0: leftY, ly1: leftY + h, ry0: rightY, ry1: rightY + h };
    leftY += h;
    rightY += h + NODE_GAP;
    return seg;
  });

  // Overspending can't be drawn as a ribbon out of income (there is no income
  // left to draw it from), so it becomes a caption instead of a lie.
  const overspent = surplus.salary > 0 && surplus.surplus < 0;
  const sourceLabel = surplus.salary > 0 ? 'Income' : 'Spending';
  const sourceAmount = surplus.salary > 0 ? surplus.salary : surplus.spend;

  return (
    <Surface>
      <SectionLabel title="Money Map" />
      <View style={styles.sourceRow}>
        <Text style={[styles.sourceLabel, { color: theme.label }]}>{sourceLabel}</Text>
        <Text style={[styles.sourceAmount, { color: theme.secondaryLabel }]}>{money(sourceAmount)}</Text>
      </View>
      <Svg width="100%" height={svgH} viewBox={`0 0 ${VIEW_W} ${svgH}`}>
        {nodes.map(({ flow, ly0, ly1, ry0, ry1 }, i) => (
          <React.Fragment key={i}>
            <Path
              d={`M ${LEFT_X + BAR_W} ${ly0} C ${midX} ${ly0} ${midX} ${ry0} ${RIGHT_X} ${ry0} L ${RIGHT_X} ${ry1} C ${midX} ${ry1} ${midX} ${ly1} ${LEFT_X + BAR_W} ${ly1} Z`}
              fill={flow.color}
              fillOpacity={flow.muted ? 0.18 : 0.3}
            />
            <Rect x={LEFT_X} y={ly0} width={BAR_W} height={ly1 - ly0} fill={flow.color} fillOpacity={0.85} />
            <Rect x={RIGHT_X} y={ry0} width={NODE_W} height={ry1 - ry0} rx={2} fill={flow.color} />
            <SvgText x={LABEL_X} y={(ry0 + ry1) / 2 - 2} fontSize={12} fontWeight="600" fill={theme.label}>
              {truncate(flow.label)}
            </SvgText>
            <SvgText x={LABEL_X} y={(ry0 + ry1) / 2 + 12} fontSize={11} fill={theme.secondaryLabel}>
              {money(flow.amount)}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
      {overspent && (
        <Text style={[styles.caption, { color: theme.negativeMuted }]}>
          Spending and savings outran income by {money(-surplus.surplus)} this month.
        </Text>
      )}
    </Surface>
  );
}

// SVG text has no numberOfLines — long category names are cut by hand so they
// never collide with the card edge.
function truncate(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const styles = StyleSheet.create({
  sourceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sourceLabel: { fontSize: 15, fontWeight: '700' },
  sourceAmount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  caption: { fontSize: 12, marginTop: spacing.sm },
});

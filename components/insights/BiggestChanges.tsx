import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { AmountText } from '../AmountText';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing } from '../../theme/colors';
import { computeCategoryMovers } from '../../lib/queries';
import type { CategoryMover } from '../../lib/models';

/**
 * Top 3 category movers vs last month. Each row pushes to the Transactions tab
 * so "why did Dining jump?" is one tap from its receipts. The transactions
 * screen keeps its card/category filters in LOCAL state with no route-param
 * plumbing, so this deliberately navigates without pre-applying a filter —
 * building that plumbing is not this card's job.
 */
export function BiggestChanges() {
  const theme = useTheme();
  const router = useRouter();
  const { selectedMonth, settings } = useBudget();
  const [movers, setMovers] = useState<CategoryMover[]>([]);

  useEffect(() => {
    let alive = true;
    computeCategoryMovers(selectedMonth).then((m) => alive && setMovers(m));
    return () => {
      alive = false;
    };
  }, [selectedMonth]);

  // Sub-dollar wobble is noise, not a change worth a review-night row.
  const top = movers.filter((m) => Math.abs(m.delta) >= 1).slice(0, 3);
  if (top.length === 0) return null;

  return (
    <Surface>
      <SectionLabel title="Biggest Changes" right="vs Last Month" />
      <View style={{ marginTop: spacing.xs }}>
        {top.map((m, i) => (
          <Pressable
            key={m.category.id}
            onPress={() => router.push('/(tabs)/transactions')}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
          >
            <Text style={[styles.name, { color: theme.label }]} numberOfLines={1}>
              {m.category.name}
            </Text>
            <View style={styles.right}>
              <AmountText amount={m.current} currency={settings.currency} size={14} color={theme.secondaryLabel} />
              {m.percentChange === null ? (
                <Text style={[styles.newTag, { color: theme.tertiaryLabel }]}>NEW</Text>
              ) : (
                <DeltaTag pct={m.percentChange} />
              )}
              <Ionicons name="chevron-forward" size={14} color={theme.tertiaryLabel} />
            </View>
          </Pressable>
        ))}
      </View>
    </Surface>
  );
}

function DeltaTag({ pct }: { pct: number }) {
  const theme = useTheme();
  // Spending up is the "bad" direction, so up = muted red, down = muted green.
  const up = pct >= 0;
  const color = up ? theme.negativeMuted : theme.positiveMuted;
  return (
    <Text style={[styles.delta, { color }]}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  name: { flex: 1, fontSize: 15, marginRight: spacing.md },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  newTag: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  delta: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing } from '../../theme/colors';
import { currentYearMonth } from '../../lib/db';
import { formatCurrency, maskedAmount } from '../../lib/format';
import { getHistoricalCategoryProjections } from '../../features/predictive-engine';
import type { CategoryProjection } from '../../features/models';

/**
 * The month-end projection, spoken as sentences instead of a wall of bars —
 * "Groceries is pacing to $612 of its $600 budget." A sentence carries the
 * verdict AND the numbers in one glance, which is the whole Review Night idea.
 *
 * Current month only: the forecast projects the REST of the month from
 * spend-to-date, which is meaningless for a month that is already over (the
 * answer is just the actual) or hasn't started.
 */
export function Outlook() {
  const theme = useTheme();
  const { selectedMonth, categories, settings } = useBudget();
  const isCurrentMonth = selectedMonth === currentYearMonth();
  const [projections, setProjections] = useState<CategoryProjection[]>([]);

  useEffect(() => {
    let alive = true;
    if (isCurrentMonth) {
      getHistoricalCategoryProjections(3).then((p) => alive && setProjections(p));
    } else {
      setProjections([]);
    }
    return () => {
      alive = false;
    };
  }, [selectedMonth, isCurrentMonth]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const money = (v: number) => (settings.hideAmounts ? maskedAmount(settings.currency) : formatCurrency(v, settings.currency));

  if (!isCurrentMonth) return null;
  const budgeted = projections.filter((p) => p.budgetLimit > 0);
  if (budgeted.length === 0) return null;

  const concerns = budgeted
    .filter((p) => p.status !== 'on_track')
    .sort((a, b) => b.projectedFinalSpend / b.budgetLimit - a.projectedFinalSpend / a.budgetLimit);

  return (
    <Surface>
      <SectionLabel title="Month-End Outlook" />
      {concerns.length === 0 ? (
        <Text style={[styles.sentence, { color: theme.positiveMuted, marginTop: spacing.sm }]}>
          Every budgeted category is pacing within its limit.
        </Text>
      ) : (
        <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
          {concerns.map((p) => {
            const name = categoryById.get(p.categoryId)?.name ?? 'A category';
            const over = p.status === 'over_budget';
            return (
              <Text key={p.categoryId} style={[styles.sentence, { color: theme.secondaryLabel }]}>
                <Text style={[styles.name, { color: theme.label }]}>{name}</Text> is pacing to{' '}
                <Text style={[styles.figure, { color: over ? theme.negativeMuted : theme.label }]}>
                  {money(p.projectedFinalSpend)}
                </Text>{' '}
                of its {money(p.budgetLimit)} budget{over ? ' — trending over.' : ' — running high.'}
              </Text>
            );
          })}
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  sentence: { fontSize: 14, lineHeight: 21 },
  name: { fontWeight: '600' },
  figure: { fontWeight: '700', fontVariant: ['tabular-nums'] },
});

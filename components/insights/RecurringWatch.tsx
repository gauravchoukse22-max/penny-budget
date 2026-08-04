import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { AmountText } from '../AmountText';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, hexToRgba } from '../../theme/colors';
import { listAllTransactions } from '../../lib/queries';
import { listRecurringTransactions } from '../../features/recurring-transactions';
import { detectRecurringCharges, type RecurringCandidate } from '../../lib/recurring-detect';

/**
 * Likely recurring charges mined from the whole transaction history (same note
 * in 3+ distinct months, amounts within 10% — lib/recurring-detect.ts), minus
 * anything an ACTIVE recurring rule already covers. The card exists for the
 * subscriptions nobody set a rule for — the tracked ones already post
 * themselves and have their own management screen; re-listing them is noise.
 *
 * History-wide rather than month-scoped on purpose: whether Netflix is a
 * recurring charge is a fact about the history, not about July — so this
 * refreshes on focus, not on the month switcher.
 */
export function RecurringWatch() {
  const theme = useTheme();
  const { settings } = useBudget();
  const [candidates, setCandidates] = useState<RecurringCandidate[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([listAllTransactions(), listRecurringTransactions()]).then(([txs, rules]) => {
        if (!alive) return;
        const tracked = rules.filter((r) => r.active).map((r) => r.note);
        setCandidates(detectRecurringCharges(txs, { excludeNotes: tracked }));
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  if (candidates.length === 0) return null;
  const top = candidates.slice(0, 5);

  return (
    <Surface>
      <SectionLabel title="Recurring Watch" right="Untracked" />
      <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
        These charge you most months but have no recurring rule.
      </Text>
      <View>
        {top.map((c, i) => (
          <View
            key={c.normalizedNote}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
          >
            <View style={styles.left}>
              <Text style={[styles.name, { color: theme.label }]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={[styles.meta, { color: theme.tertiaryLabel }]}>
                Seen in {c.monthsSeen} months
              </Text>
            </View>
            <View style={styles.right}>
              {c.priceWentUp && (
                <View style={[styles.pricePill, { backgroundColor: hexToRgba('#B23B3B', 0.12) }]}>
                  <Text style={[styles.pricePillText, { color: theme.negativeMuted }]}>PRICE WENT UP</Text>
                </View>
              )}
              <AmountText amount={c.typicalAmount} currency={settings.currency} size={15} weight="semibold" color={theme.label} />
            </View>
          </View>
        ))}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, marginTop: 2, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  left: { flex: 1, marginRight: spacing.md },
  name: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 12, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pricePill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill },
  pricePillText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});

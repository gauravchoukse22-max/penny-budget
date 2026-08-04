import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, type as typeScale } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { AmountText } from '../../components/AmountText';
import { Button } from '../../components/Button';
import { FundEntryRow } from '../../components/FundEntryRow';
import { formatMonthLabel } from '../../lib/format';
import {
  buildFundMonthlyHistory,
  listFundAccounts,
  listFundEntriesForFund,
  listFunds,
  migrateFundBalancesToEntries,
} from '../../features/funds';
import type { Fund, FundAccount, FundEntry } from '../../features/models';

/**
 * One fund's history, month by month — "how much did we put into Child /
 * Education in April?", which is the question the whole ledger exists for.
 *
 * Months are the unit rather than a flat list because that's how the money
 * actually goes in: a transfer a month, per account. A flat list of forty
 * entries makes you do the adding up yourself.
 */
export default function FundHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useBudget();

  const [fund, setFund] = useState<Fund | null>(null);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [entries, setEntries] = useState<FundEntry[]>([]);
  // null = untouched, so the default (newest month open) still applies.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    // Same backfill the grid runs — this screen is reachable directly from a
    // deep link, so it can't assume the grid has already been visited.
    await migrateFundBalancesToEntries();
    const [funds, accountRows, entryRows] = await Promise.all([
      listFunds(),
      listFundAccounts(),
      listFundEntriesForFund(id),
    ]);
    setFund(funds.find((f) => f.id === id) ?? null);
    setAccounts(accountRows);
    setEntries(entryRows);
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  // Drop entries whose account has been deleted, exactly as the grid does, so
  // this screen's total is the same number the grid shows for the row.
  const liveEntries = useMemo(() => entries.filter((e) => accountName.has(e.accountId)), [entries, accountName]);

  const months = useMemo(() => buildFundMonthlyHistory(liveEntries), [liveEntries]);

  const total = months.length > 0 ? months[0].balanceAfter : 0;

  // The newest month opens by default: it's the one being asked about most of
  // the time, and an all-collapsed list gives you nothing to read on arrival.
  const openMonths = expanded ?? new Set(months[0] ? [months[0].yearMonth] : []);

  const toggle = (yearMonth: string) => {
    const next = new Set(openMonths);
    if (next.has(yearMonth)) next.delete(yearMonth);
    else next.add(yearMonth);
    setExpanded(next);
  };

  if (!loaded) return <View style={{ flex: 1, backgroundColor: theme.groupedBackground }} />;

  if (!fund) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="help-circle-outline" size={40} color={theme.tertiaryLabel} />
        <Text style={[styles.emptyTitle, { color: theme.label }]}>Fund not found</Text>
        <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>It may have been deleted on another device.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Surface>
        <Text style={[typeScale.caption, { color: theme.tertiaryLabel, letterSpacing: 0.6 }]}>IN THIS FUND</Text>
        <AmountText amount={total} currency={settings.currency} size={30} weight="bold" />
        <Text style={[styles.subtitle, { color: theme.secondaryLabel }]}>
          {fund.name} · {liveEntries.length} {liveEntries.length === 1 ? 'entry' : 'entries'} across{' '}
          {months.length} {months.length === 1 ? 'month' : 'months'}
        </Text>
      </Surface>

      {months.length === 0 ? (
        <Surface>
          <Text style={[styles.emptyTitle, { color: theme.label, marginTop: 0 }]}>Nothing recorded yet</Text>
          <Text style={[styles.emptyBody, { color: theme.secondaryLabel, textAlign: 'left' }]}>
            Add to this fund from the grid and every contribution — the amount, the date and your note — shows up here.
          </Text>
        </Surface>
      ) : (
        months.map((month) => {
          const open = openMonths.has(month.yearMonth);
          return (
            <Surface key={month.yearMonth}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${formatMonthLabel(month.yearMonth)}, ${open ? 'collapse' : 'expand'}`}
                onPress={() => toggle(month.yearMonth)}
                style={styles.monthHeader}
              >
                <View style={styles.monthText}>
                  <Text style={[styles.monthLabel, { color: theme.label }]}>{formatMonthLabel(month.yearMonth)}</Text>
                  <Text style={[styles.monthMeta, { color: theme.tertiaryLabel }]}>
                    {month.removed > 0 ? 'Added / taken out' : 'Added'} · balance after
                  </Text>
                </View>
                <View style={styles.monthNumbers}>
                  <AmountText
                    amount={month.net}
                    currency={settings.currency}
                    size={17}
                    weight="bold"
                    color={month.net >= 0 ? theme.positiveMuted : theme.negativeMuted}
                  />
                  <AmountText amount={month.balanceAfter} currency={settings.currency} size={12} color={theme.tertiaryLabel} />
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.tertiaryLabel} />
              </Pressable>

              {/* Only worth the extra line when money went both ways — netting
                  2,000 in against 1,800 out to "+200" hides a busy month. */}
              {month.removed > 0 && (
                <View style={styles.splitRow}>
                  <AmountText
                    amount={month.added}
                    currency={settings.currency}
                    size={12}
                    weight="semibold"
                    color={theme.positiveMuted}
                  />
                  <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>in ·</Text>
                  <AmountText
                    amount={month.removed}
                    currency={settings.currency}
                    size={12}
                    weight="semibold"
                    color={theme.negativeMuted}
                  />
                  <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>out</Text>
                </View>
              )}

              {open && (
                <View style={styles.entries}>
                  {month.entries.map((entry) => (
                    <FundEntryRow
                      key={entry.id}
                      entry={entry}
                      currency={settings.currency}
                      accountName={accountName.get(entry.accountId)}
                    />
                  ))}
                </View>
              )}
            </Surface>
          );
        })
      )}

      <Button label="Back to the grid" icon="grid-outline" onPress={() => router.push('/funds')} variant="tonal" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  subtitle: { fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  monthText: { flex: 1, gap: 2 },
  monthLabel: { fontSize: 16, fontWeight: '700' },
  monthMeta: { fontSize: 11 },
  monthNumbers: { alignItems: 'flex-end', gap: 2 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  entries: { marginTop: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});

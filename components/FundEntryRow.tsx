import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, spacing } from '../theme/colors';
import { IconButton } from './Button';
import { formatShortDate } from '../lib/format';
import { AmountText } from './AmountText';
import type { FundEntry } from '../features/models';

type Props = {
  entry: FundEntry;
  currency: string;
  /** Only worth showing where a row could have come from any column. */
  accountName?: string;
  onDelete?: (entry: FundEntry) => void;
};

/**
 * One line of a fund's history: when, why, how much.
 *
 * The sign is carried by colour and the leading "−" rather than a "+" prefix,
 * because the amount is rendered through AmountText — that's what honours the
 * "Hide amounts" privacy setting, and formatting the string by hand here would
 * quietly show real balances on a screen the user asked to mask.
 */
export function FundEntryRow({ entry, currency, accountName, onDelete }: Props) {
  const theme = useTheme();
  const isCredit = entry.amount >= 0;
  const detail = [accountName, entry.note].filter(Boolean).join(' · ');

  return (
    <View style={[styles.row, { borderBottomColor: theme.separator }]}>
      <View style={styles.text}>
        <Text style={[styles.date, { color: theme.label }]}>{formatShortDate(entry.date)}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: theme.secondaryLabel }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : (
          <Text style={[styles.detail, { color: theme.tertiaryLabel }]}>No note</Text>
        )}
      </View>
      <AmountText
        amount={entry.amount}
        currency={currency}
        size={15}
        weight="semibold"
        color={isCredit ? theme.positiveMuted : theme.negativeMuted}
      />
      {onDelete && (
        <IconButton
          icon="close"
          onPress={() => onDelete(entry)}
          variant="destructive"
          accessibilityLabel={`Remove the entry from ${formatShortDate(entry.date)}`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
  date: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 17 },
});

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CategoryIcon } from './CategoryIcon';
import { AmountText } from './AmountText';
import { useTheme } from '../theme/colors';
import type { Category, Card, Transaction } from '../lib/models';

export function TransactionRow({
  transaction,
  category,
  card,
  currency,
  onPress,
}: {
  transaction: Transaction;
  category?: Category;
  card?: Card;
  currency: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <CategoryIcon icon={category?.icon ?? 'help-circle'} color={category?.color ?? theme.secondaryLabel} size={17} />
      <View style={styles.middle}>
        <Text style={[styles.title, { color: theme.label }]} numberOfLines={1}>
          {transaction.note || category?.name || 'Uncategorized'}
        </Text>
        <View style={styles.subRow}>
          {card && (
            <View style={[styles.badge, { backgroundColor: card.color }]}>
              <Text style={styles.badgeText}>{card.name}</Text>
            </View>
          )}
          {transaction.source === 'imported' && <Text style={[styles.sourceTag, { color: theme.tertiaryLabel }]}>Imported</Text>}
        </View>
      </View>
      <AmountText amount={transaction.amount} currency={currency} size={16} weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  middle: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sourceTag: {
    fontSize: 11,
  },
});

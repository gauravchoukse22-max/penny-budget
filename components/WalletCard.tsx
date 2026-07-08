import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AmountText } from './AmountText';
import { radius } from '../theme/colors';
import type { Card } from '../lib/models';

export function WalletCard({
  card,
  total,
  currency,
  onPress,
}: {
  card: Card;
  total: number;
  currency: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: card.color, opacity: pressed ? 0.9 : 1 }]}>
      <View style={styles.topRow}>
        <Text style={styles.name}>{card.name}</Text>
      </View>
      <View style={styles.bottomRow}>
        <Text style={styles.lastFour}>•••• {card.lastFour}</Text>
        <AmountText amount={total} currency={currency} size={22} weight="bold" color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: 20,
    height: 130,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  lastFour: {
    color: '#FFFFFFCC',
    fontSize: 15,
    letterSpacing: 1.5,
  },
});

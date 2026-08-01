import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AmountText } from './AmountText';
import { radius, spacing, mixHex, useTheme } from '../theme/colors';
import type { Card } from '../lib/models';

// A restrained, Apple Wallet / Amex-style card: the stored bright hue is blended
// deep toward graphite so every card reads as a quiet metal card, with the
// original color surviving only as a small identity accent. Text stays near-white
// in both light and dark mode — a card is a dark object either way.
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
  const theme = useTheme();
  const isHex = /^#[0-9a-fA-F]{6}$/.test(card.color);
  const tone = isHex ? mixHex(card.color, theme.walletBase, 0.8) : theme.walletBase;
  const gradient: [string, string] = [mixHex(tone, '#FFFFFF', 0.1), mixHex(tone, '#000000', 0.22)];
  const accent = isHex ? mixHex(card.color, '#FFFFFF', 0.15) : '#FFFFFF';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.name}
          </Text>
          <View style={[styles.accentDot, { backgroundColor: accent }]} />
        </View>

        <View style={styles.hairline} />

        <View style={styles.bottomRow}>
          <Text style={styles.lastFour}>•••• {card.lastFour}</Text>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>THIS MONTH</Text>
            <AmountText amount={total} currency={currency} size={24} weight="bold" color="#FFFFFF" />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    height: 150,
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  accentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: spacing.md,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  lastFour: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  amountBlock: {
    alignItems: 'flex-end',
  },
  amountLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
});

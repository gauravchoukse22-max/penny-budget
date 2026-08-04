import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Surface } from '../Surface';
import { SectionLabel } from './common';
import { AmountText } from '../AmountText';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, hexToRgba } from '../../theme/colors';

/** The ranked category breakdown for the month — every category with spend,
 * largest first, each bar scaled to the biggest spender and tappable through
 * to that category's own screen. */
export function WhereItGoes() {
  const theme = useTheme();
  const router = useRouter();
  const { categorySummaries, settings } = useBudget();

  const breakdown = categorySummaries.filter((s) => s.spend > 0);
  if (breakdown.length === 0) return null;

  const total = breakdown.reduce((sum, s) => sum + s.spend, 0);
  const max = Math.max(...breakdown.map((s) => s.spend), 1);

  return (
    <Surface>
      <SectionLabel title="Where It Goes" />
      <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
        {breakdown.map((s) => {
          const over = s.status === 'red';
          const share = total > 0 ? Math.round((s.spend / total) * 100) : 0;
          return (
            <Pressable key={s.category.id} onPress={() => router.push(`/category/${s.category.id}`)}>
              <View style={styles.top}>
                <Text style={[styles.name, { color: theme.label }]} numberOfLines={1}>
                  {s.category.name}
                </Text>
                <View style={styles.amounts}>
                  {over && <Text style={[styles.overTag, { color: theme.negativeMuted }]}>OVER</Text>}
                  <AmountText amount={s.spend} currency={settings.currency} size={14} weight="semibold" color={theme.label} />
                  <Text style={[styles.share, { color: theme.tertiaryLabel }]}>{share}%</Text>
                </View>
              </View>
              <View style={[styles.track, { backgroundColor: theme.neutralTrack }]}>
                <View
                  style={{
                    width: `${Math.max(3, (s.spend / max) * 100)}%`,
                    height: '100%',
                    borderRadius: radius.pill,
                    backgroundColor: over ? theme.negativeMuted : hexToRgba(theme.label, 0.55),
                  }}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  name: { flex: 1, fontSize: 15, marginRight: spacing.md },
  amounts: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  share: { fontSize: 12, width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  overTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
});

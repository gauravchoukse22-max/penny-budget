import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/colors';

/** The small-caps header every Insights card leads with — shared so the cards
 * stay visually one family even though each is an independent component. */
export function SectionLabel({ title, right }: { title: string; right?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.secondaryLabel }]}>{title.toUpperCase()}</Text>
      {right && <Text style={[styles.right, { color: theme.tertiaryLabel }]}>{right.toUpperCase()}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  right: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
});

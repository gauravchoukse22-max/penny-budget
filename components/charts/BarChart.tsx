import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/colors';
import { EmptyChart } from './LineChart';

type BarGroup = { label: string; values: { value: number; color: string }[] };

export function BarChart({ groups, height = 160 }: { groups: BarGroup[]; height?: number }) {
  const theme = useTheme();
  const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v.value)));
  if (groups.length === 0) return <EmptyChart height={height} />;

  return (
    <View style={[styles.row, { height }]}>
      {groups.map((g, i) => (
        <View key={i} style={styles.group}>
          <View style={styles.bars}>
            {g.values.map((v, j) => (
              <View
                key={j}
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, (v.value / max) * (height - 24)),
                    backgroundColor: v.color,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: theme.tertiaryLabel }]} numberOfLines={1}>
            {g.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  group: {
    alignItems: 'center',
    flex: 1,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    width: 10,
    borderRadius: 3,
  },
  label: {
    fontSize: 10,
    marginTop: 6,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '../../theme/colors';
import { EmptyChart } from './LineChart';

type Slice = { label: string; value: number; color: string };

export function DonutChart({ slices, size = 180, strokeWidth = 26 }: { slices: Slice[]; size?: number; strokeWidth?: number }) {
  const theme = useTheme();
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total <= 0) return <EmptyChart height={size} />;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetSoFar = 0;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.tertiaryBackground} strokeWidth={strokeWidth} fill="none" />
          {slices.map((slice, i) => {
            const fraction = slice.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const strokeDashoffset = -offsetSoFar;
            offsetSoFar += dash;
            return (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={strokeDashoffset}
                fill="none"
                strokeLinecap="butt"
              />
            );
          })}
        </G>
      </Svg>
      <View style={styles.legend}>
        {slices.map((s, i) => (
          <View key={i} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={[styles.legendLabel, { color: theme.label }]} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={[styles.legendPercent, { color: theme.secondaryLabel }]}>{Math.round((s.value / total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    marginTop: 16,
    width: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendLabel: {
    flex: 1,
    fontSize: 14,
  },
  legendPercent: {
    fontSize: 13,
  },
});

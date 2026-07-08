import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { useTheme } from '../../theme/colors';
import { formatShortMonth } from '../../lib/format';

type Point = { yearMonth: string; value: number };

export function LineChart({ points, height = 160, color }: { points: Point[]; height?: number; color?: string }) {
  const theme = useTheme();
  const strokeColor = color ?? theme.systemBlue;
  const width = 320;
  const padding = 16;

  if (points.length === 0) {
    return <EmptyChart height={height} />;
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const coords = points.map((p, i) => {
    const x = padding + (i / Math.max(1, points.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((p.value - min) / range) * chartHeight;
    return { x, y };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const zeroY = padding + chartHeight - ((0 - min) / range) * chartHeight;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke={theme.separator} strokeWidth={1} />
        <Polyline points={polylinePoints} fill="none" stroke={strokeColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <Circle key={i} cx={c.x} cy={c.y} r={3.5} fill={strokeColor} />
        ))}
      </Svg>
      <View style={styles.labelsRow}>
        {points.map((p, i) => (
          <Text key={i} style={[styles.label, { color: theme.tertiaryLabel }]}>
            {formatShortMonth(p.yearMonth)}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function EmptyChart({ height = 160 }: { height?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, { height }]}>
      <Text style={{ color: theme.tertiaryLabel }}>No data yet</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginTop: 4,
  },
  label: {
    fontSize: 11,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

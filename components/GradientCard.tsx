import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, spacing } from '../theme/colors';

export function GradientCard({
  colors,
  style,
  children,
}: {
  colors: readonly [string, string, ...string[]];
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          borderRadius: radius.lg,
          padding: spacing.lg,
          shadowColor: colors[0],
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 4,
        },
        style,
      ]}
    >
      <View>{children}</View>
    </LinearGradient>
  );
}

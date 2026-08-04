import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const CATEGORY_ICON_CHOICES = [
  'cart',
  'flash',
  'home',
  'shirt',
  'restaurant',
  'car',
  'medkit',
  'fitness',
  'film',
  'gift',
  'school',
  'paw',
  'airplane',
  'phone-portrait',
  'ellipsis-horizontal-circle',
] as const;

export function CategoryIcon({
  icon,
  color,
  size = 22,
  plain = false,
}: {
  icon: string;
  color: string;
  size?: number;
  /**
   * Just the glyph, tinted `color`, no disc behind it. For rendering inside a
   * surface that already has its own fill — a selected chip passing white got
   * a white disc with a white glyph on it: a blank circle.
   */
  plain?: boolean;
}) {
  if (plain) return <Ionicons name={icon as any} size={size} color={color} />;
  const boxSize = size * 1.9;
  return (
    <View
      style={[
        styles.box,
        {
          width: boxSize,
          height: boxSize,
          borderRadius: boxSize / 2,
          backgroundColor: color,
          shadowColor: color,
        },
      ]}
    >
      <Ionicons name={icon as any} size={size} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
});

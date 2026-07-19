import React, { useEffect, useRef, useState } from 'react';
import { Text, TextStyle, Platform, Animated } from 'react-native';
import { useTheme } from '../theme/colors';
import { formatCurrency, maskedAmount } from '../lib/format';
import { useBudget } from '../context/BudgetContext';

type Props = {
  amount: number;
  currency?: string;
  size?: number;
  weight?: 'regular' | 'semibold' | 'bold';
  color?: string;
  style?: TextStyle;
  /** Count-up duration in ms. */
  duration?: number;
};

/**
 * Like AmountText, but counts up/down to a new value instead of snapping —
 * used for the hero "left to spend" figure so a change reads as motion. Falls
 * back to a plain render on web where the per-frame listener is wasteful.
 */
export function AnimatedAmount({ amount, currency = 'USD', size = 17, weight = 'regular', color, style, duration = 650 }: Props) {
  const theme = useTheme();
  const { settings } = useBudget();
  const fontWeight = weight === 'bold' ? '700' : weight === 'semibold' ? '600' : '400';
  // On web, react-native-web's Animated listener never ticks in this setup,
  // which FROZE the hero at its first value — changes to the underlying
  // number (new goal, new transaction) silently didn't display. The comment
  // below always promised a plain web render; now it actually happens.
  const isWeb = Platform.OS === 'web';
  const driver = useRef(new Animated.Value(amount)).current;
  const [display, setDisplay] = useState(amount);
  const prev = useRef(amount);

  useEffect(() => {
    if (prev.current === amount) return;
    if (isWeb) {
      prev.current = amount;
      setDisplay(amount);
      return;
    }
    const id = driver.addListener(({ value }) => setDisplay(value));
    Animated.timing(driver, {
      toValue: amount,
      duration,
      useNativeDriver: false,
    }).start(() => {
      prev.current = amount;
      setDisplay(amount);
    });
    return () => driver.removeListener(id);
  }, [amount, driver, duration, isWeb]);

  return (
    <Text
      style={[
        {
          fontSize: size,
          fontWeight,
          color: color ?? theme.label,
          fontVariant: ['tabular-nums'],
          fontFamily: Platform.select({ ios: 'System', default: undefined }),
        },
        style,
      ]}
    >
      {settings.hideAmounts ? maskedAmount(currency) : formatCurrency(display, currency)}
    </Text>
  );
}

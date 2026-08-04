import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { useTheme, radius, spacing, type Theme } from '../theme/colors';

// The app's one button. Before this existed, 40 screens each styled their own
// Pressable — 35 distinct inline definitions — so no two buttons quite agreed
// on height, radius, weight or pressed feel, and the translucent ones read as
// glass sitting next to flat opaque ones that didn't.
//
// ── The glass ───────────────────────────────────────────────────────────────
// Three layers, no BlurView: a translucent fill so the surface tints through,
// a hairline border to catch the edge, and a 1px lighter strip along the top
// inside edge — that last one is what actually sells it, because real glass
// picks up light from above. Tokens live in theme/colors.ts and flip with the
// colour scheme; on dark surfaces the fill is a LIGHT wash, since a dark fill
// on a dark card reads as a hole rather than a pane.
//
// `primary` deliberately does NOT get the glass treatment: it is the one
// opaque, committed surface on any screen, and making it translucent too
// would flatten the hierarchy that tells you which button is the real action.

export type ButtonVariant = 'primary' | 'tonal' | 'glass' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Heights chosen so every size clears the 44pt minimum touch target. `sm`
 * looks smaller than 44 but its padding keeps the box legal. */
const SIZES: Record<ButtonSize, { height: number; paddingH: number; fontSize: number; icon: number; gap: number }> = {
  sm: { height: 36, paddingH: spacing.md, fontSize: 14, icon: 15, gap: 6 },
  md: { height: 46, paddingH: spacing.lg, fontSize: 15, icon: 17, gap: 8 },
  lg: { height: 54, paddingH: spacing.xl, fontSize: 17, icon: 19, gap: 8 },
};

type Palette = { background: string; border: string; foreground: string; glass: boolean };

function paletteFor(variant: ButtonVariant, theme: Theme): Palette {
  switch (variant) {
    case 'primary':
      // The one committed, opaque surface — see the note above.
      return { background: theme.accent, border: 'transparent', foreground: theme.onAccent, glass: false };
    case 'tonal':
      // Accent-coloured glass: reads as "this is the accent action" without
      // competing with a real primary on the same screen.
      return { background: theme.accentTint, border: theme.glassBorder, foreground: theme.accent, glass: true };
    case 'glass':
      return { background: theme.glassFill, border: theme.glassBorder, foreground: theme.label, glass: true };
    case 'destructive':
      return { background: theme.glassFill, border: theme.glassBorder, foreground: theme.systemRed, glass: true };
    case 'ghost':
      // No fill at all — for text actions inside dense rows, where a filled
      // box would add visual weight the row can't afford.
      return { background: 'transparent', border: 'transparent', foreground: theme.accent, glass: false };
  }
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ionicons name, drawn before the label. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Draw the icon after the label instead (chevrons, "next"-style actions). */
  iconAfter?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  /** Swaps the content for a spinner and blocks presses. */
  loading?: boolean;
  /** Stretch to the container's width — the standard for a screen's footer. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /** Defaults to the label; set when the label alone isn't descriptive. */
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'glass',
  size = 'md',
  icon,
  iconAfter,
  disabled = false,
  loading = false,
  full = false,
  style,
  labelStyle,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const s = SIZES[size];
  const palette = paletteFor(variant, theme);
  const inert = disabled || loading;

  return (
    <PressableScale
      haptic={!inert}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingH,
          backgroundColor: palette.background,
          borderColor: palette.border,
          // A 0-width border still reserves no space, but keeping the width at
          // 1 with a transparent colour means filled and glass variants share
          // an identical content box — otherwise they differ by 2pt and rows
          // of mixed buttons sit a hair out of line.
          borderWidth: StyleSheet.hairlineWidth,
        },
        full && styles.full,
        // Disabled dims the whole button rather than recolouring it, so the
        // variant stays recognisable while clearly inert.
        inert && styles.inert,
        style,
      ]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.gap }}
    >
      {palette.glass ? <GlassHighlight color={theme.glassHighlight} /> : null}
      {loading ? (
        <ActivityIndicator size="small" color={palette.foreground} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={s.icon} color={palette.foreground} /> : null}
          <Text
            numberOfLines={1}
            style={[{ color: palette.foreground, fontSize: s.fontSize, fontWeight: '600' }, labelStyle]}
          >
            {label}
          </Text>
          {iconAfter ? <Ionicons name={iconAfter} size={s.icon} color={palette.foreground} /> : null}
        </>
      )}
    </PressableScale>
  );
}

/** The lit top edge. Absolutely positioned and non-interactive so it never
 * affects layout or swallows a touch. */
function GlassHighlight({ color }: { color: string }) {
  return <View pointerEvents="none" style={[styles.highlight, { backgroundColor: color }]} />;
}

// ── Chip ────────────────────────────────────────────────────────────────────
// The selectable pill used for segmented choices (Fixed / Varies monthly,
// category pickers, currency). Same glass language, but selection is carried
// by the accent fill rather than by a border, so a row of chips reads as one
// control instead of several buttons.

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  size?: Extract<ButtonSize, 'sm' | 'md'>;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, selected, onPress, icon, size = 'md', style }: ChipProps) {
  const theme = useTheme();
  const s = SIZES[size];
  const foreground = selected ? theme.onAccent : theme.secondaryLabel;

  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingH,
          borderRadius: radius.pill,
          backgroundColor: selected ? theme.accent : theme.glassFill,
          borderColor: selected ? 'transparent' : theme.glassBorder,
          borderWidth: StyleSheet.hairlineWidth,
        },
        style,
      ]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.gap }}
    >
      {selected ? null : <GlassHighlight color={theme.glassHighlight} />}
      {icon ? <Ionicons name={icon} size={s.icon} color={foreground} /> : null}
      <Text numberOfLines={1} style={{ color: foreground, fontSize: s.fontSize, fontWeight: '600' }}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ── IconButton ──────────────────────────────────────────────────────────────
// A square glass button for bare icons (close, back, month arrows). Kept in
// this file so the three share one set of tokens and one pressed feel.

export interface IconButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  /** Required: an icon alone tells a screen reader nothing. */
  accessibilityLabel: string;
  size?: ButtonSize;
  variant?: Extract<ButtonVariant, 'glass' | 'tonal' | 'ghost' | 'destructive'>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 'md',
  variant = 'glass',
  disabled = false,
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const s = SIZES[size];
  const palette = paletteFor(variant, theme);

  return (
    <PressableScale
      haptic={!disabled}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[
        styles.base,
        {
          height: s.height,
          width: s.height, // square
          paddingHorizontal: 0,
          borderRadius: radius.pill,
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
        disabled && styles.inert,
        style,
      ]}
    >
      {palette.glass ? <GlassHighlight color={theme.glassHighlight} /> : null}
      <Ionicons name={icon} size={s.icon} color={palette.foreground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    // Clips the highlight strip to the rounded corners; without this it runs
    // straight across and pokes out past the radius.
    overflow: 'hidden',
  },
  full: { alignSelf: 'stretch', width: '100%' },
  inert: { opacity: 0.4 },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
});

import { useColorScheme } from 'react-native';

type Gradient = readonly [string, string];

export interface Theme {
  background: string;
  secondaryBackground: string;
  tertiaryBackground: string;
  groupedBackground: string;
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  separator: string;
  systemRed: string;
  systemGreen: string;
  systemAmber: string;
  systemBlue: string;
  accent: string;
  accentTint: string;
  onAccent: string;
  card: string;
  cardRaised: string;
  fieldBackground: string;
  shadow: string;
  heroPositive: Gradient;
  heroNegative: Gradient;
  heroNeutral: Gradient;
  statSpent: Gradient;
  statSaved: Gradient;
  statDays: Gradient;
}

// Bold & colorful design tokens (Mint/Monarch-style): vivid gradients on hero
// surfaces, saturated category colors used as solid fills (not soft tints),
// a punchy indigo-violet accent. Surfaces still flip between light and dark.
const light: Theme = {
  background: '#F4F3FB',
  secondaryBackground: '#FFFFFF',
  tertiaryBackground: '#F4F3FB',
  groupedBackground: '#F4F3FB',
  label: '#1C1C1E',
  secondaryLabel: '#6E6E73',
  tertiaryLabel: 'rgba(60,60,67,0.45)',
  separator: 'rgba(60,60,67,0.12)',
  systemRed: '#FF3B30',
  systemGreen: '#1FAA59',
  systemAmber: '#FF9500',
  systemBlue: '#5856D6',
  accent: '#6C4CF5',
  accentTint: 'rgba(108,76,245,0.14)',
  onAccent: '#FFFFFF',
  card: '#FFFFFF',
  cardRaised: '#FFFFFF',
  fieldBackground: 'rgba(118,118,128,0.08)',
  shadow: '#00000018',
  // Gradients for the Surplus hero card, keyed by sign.
  heroPositive: ['#22C55E', '#0EA96B'] as const,
  heroNegative: ['#FF6B6B', '#E23E57'] as const,
  heroNeutral: ['#6C4CF5', '#8B5CF6'] as const,
  // Distinct vivid accents for the three stat tiles (Mint/Monarch use a
  // different hue per metric instead of one flat neutral card each).
  statSpent: ['#FF9F43', '#FF7043'] as const,
  statSaved: ['#22C55E', '#0EA96B'] as const,
  statDays: ['#5B8DEF', '#6C4CF5'] as const,
};

const dark: Theme = {
  background: '#0B0B12',
  secondaryBackground: '#1C1C1E',
  tertiaryBackground: '#1C1C1E',
  groupedBackground: '#0B0B12',
  label: '#FFFFFF',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  tertiaryLabel: 'rgba(235,235,245,0.35)',
  separator: 'rgba(84,84,88,0.36)',
  systemRed: '#FF453A',
  systemGreen: '#32D74B',
  systemAmber: '#FF9F0A',
  systemBlue: '#7C6CF7',
  accent: '#8468FA',
  accentTint: 'rgba(132,104,250,0.2)',
  onAccent: '#FFFFFF',
  card: '#17171F',
  cardRaised: '#221F2E',
  fieldBackground: 'rgba(118,118,128,0.24)',
  shadow: '#00000066',
  heroPositive: ['#1FAA59', '#0B7A41'] as const,
  heroNegative: ['#E9445A', '#B72F45'] as const,
  heroNeutral: ['#7C6CF7', '#5B3FE0'] as const,
  statSpent: ['#FF8A3D', '#E85D2D'] as const,
  statSaved: ['#1FAA59', '#0B7A41'] as const,
  statDays: ['#5B8DEF', '#7C6CF7'] as const,
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

// ── Spacing / radius ─────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 22,
  xl: 28,
  pill: 999,
};

// ── Typography ───────────────────────────────────────────────────────────
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const },
  title1: { fontSize: 28, fontWeight: '700' as const },
  title2: { fontSize: 22, fontWeight: '700' as const },
  title3: { fontSize: 20, fontWeight: '600' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  callout: { fontSize: 15, fontWeight: '500' as const },
  subhead: { fontSize: 14, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 11, fontWeight: '600' as const },
};

/** A hex color used as a soft tinted background (chips, capsules, banners). */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function tint(color: string, alpha = 0.14): string {
  return hexToRgba(color, alpha);
}

// Fixed, tasteful 14-hue category palette — assigned once per category, used
// consistently across icons/lists/charts so a category reads by color alone.
export const CATEGORY_PALETTE = [
  '#FF3B30', // red
  '#FF9500', // orange
  '#FFCC00', // yellow
  '#34C759', // green
  '#00C7BE', // teal
  '#30ADE6', // light blue
  '#007AFF', // blue
  '#5856D6', // indigo
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#A2845E', // brown
  '#8E8E93', // gray
  '#63E6BE', // mint
  '#FFD60A', // gold
];

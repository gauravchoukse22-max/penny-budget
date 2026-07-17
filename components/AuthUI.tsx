import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  AccessibilityInfo,
  Platform,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { evaluatePassword } from '../lib/passwordStrength';

/** iOS grouped-inset section: uppercase secondary header ABOVE, footnote helper
 * BELOW, content in a rounded card. This is the structure that reads as a native
 * settings/auth list rather than "a card with a bold heading". */
export function GroupedSection({
  header,
  footnote,
  children,
}: {
  header?: string;
  footnote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={groupStyles.wrap}>
      {header ? (
        <Text style={[groupStyles.header, { color: theme.secondaryLabel }]} accessibilityRole="header">
          {header.toUpperCase()}
        </Text>
      ) : null}
      <View style={[groupStyles.card, { backgroundColor: theme.card, shadowColor: theme.shadow }]}>{children}</View>
      {footnote ? (
        typeof footnote === 'string' ? (
          <Text style={[groupStyles.footnote, { color: theme.tertiaryLabel }]}>{footnote}</Text>
        ) : (
          footnote
        )
      ) : null}
    </View>
  );
}

const groupStyles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5, marginLeft: spacing.md },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  footnote: { fontSize: 13, lineHeight: 18, marginHorizontal: spacing.md },
});

type FieldProps = TextInputProps & {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  /** Renders a show/hide eye toggle and secures the entry. */
  secure?: boolean;
  /** Shows a clear (✕) button when non-empty. */
  clearable?: boolean;
  errorText?: string | null;
};

/** A labeled text field wired for AutoFill, Dynamic Type, and VoiceOver. */
export const AuthTextField = React.forwardRef<TextInput, FieldProps>(function AuthTextField(
  { label, value, onChangeText, secure = false, clearable = false, errorText, ...rest },
  ref
) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(secure);

  return (
    <View style={fieldStyles.wrap}>
      <Text style={[fieldStyles.label, { color: theme.secondaryLabel }]}>{label}</Text>
      <View style={[fieldStyles.inputRow, { backgroundColor: theme.fieldBackground }]}>
        <TextInput
          ref={ref}
          style={[fieldStyles.input, { color: theme.label }]}
          placeholderTextColor={theme.secondaryLabel}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          accessibilityLabel={label}
          maxFontSizeMultiplier={1.6}
          {...rest}
        />
        {clearable && value.length > 0 && !secure && (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear"
            style={fieldStyles.iconBtn}
          >
            <Ionicons name="close-circle" size={18} color={theme.tertiaryLabel} />
          </Pressable>
        )}
        {secure && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={fieldStyles.iconBtn}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={theme.secondaryLabel} />
          </Pressable>
        )}
      </View>
      {errorText ? <InlineError message={errorText} /> : null}
    </View>
  );
});

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 46 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  iconBtn: { padding: 4, marginLeft: 4 },
});

/** Footnote-style error that also announces itself to screen readers. */
export function InlineError({ message }: { message: string }) {
  const theme = useTheme();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (message && message !== last.current) {
      last.current = message;
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
  return (
    <Text style={[{ color: theme.systemRed, fontSize: 13, lineHeight: 18 }]} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

export function InfoNote({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{ color: tone === 'success' ? theme.systemGreen : theme.secondaryLabel, fontSize: 13, lineHeight: 18 }}
    >
      {message}
    </Text>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[styles.primary, { backgroundColor: theme.accent, opacity: isDisabled ? 0.5 : 1 }]}
    >
      {loading ? (
        <ActivityIndicator color={theme.onAccent} />
      ) : (
        <Text style={{ color: theme.onAccent, fontWeight: '600', fontSize: 16 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextButton({
  title,
  onPress,
  color,
  align = 'center',
}: {
  title: string;
  onPress: () => void;
  color?: string;
  align?: 'center' | 'left';
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={{ paddingVertical: 8, minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: color ?? theme.accent, fontWeight: '600', fontSize: 15, textAlign: align }}>{title}</Text>
    </Pressable>
  );
}

/** Length-first strength meter shown as-you-type on sign-up. Static fill (no
 * animation) so it's inherently reduced-motion friendly. */
export function StrengthMeter({ password }: { password: string }) {
  const theme = useTheme();
  if (password.length === 0) return null;
  const { score, label } = evaluatePassword(password);
  const colors = [theme.systemRed, theme.systemRed, theme.systemAmber, theme.systemBlue, theme.systemGreen];
  const barColor = colors[score];
  return (
    <View style={{ gap: 4 }} accessibilityRole="progressbar" accessibilityValue={{ text: `Password strength: ${label}` }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < score ? barColor : theme.separator }}
          />
        ))}
      </View>
      <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Divider that collapses to nothing when there's no social provider to show. */
export function OrDivider() {
  const theme = useTheme();
  return (
    <View style={styles.orRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.orLine, { backgroundColor: theme.separator }]} />
      <Text style={[styles.orText, { color: theme.tertiaryLabel }]}>or</Text>
      <View style={[styles.orLine, { backgroundColor: theme.separator }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  primary: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xs },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { marginHorizontal: 12, fontSize: 13, fontWeight: '600' },
});

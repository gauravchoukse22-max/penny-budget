import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, spacing, radius } from '../theme/colors';
import { parseMoneyInput } from '../lib/parse-number';

// The Planner's one input. It exists because the two things the planner needs
// most — an interest rate and a minimum payment — are numbers the app has
// never stored, so this screen has to ask for them, and asking for six of them
// with hand-rolled TextInputs is where inconsistent parsing creeps in.
//
// Parsing goes through parseMoneyInput like every other money field, so "1,500"
// is 1500 and "1e9" is rejected rather than partially parsed.

type Props = {
  label: string;
  /** Current value, or null when unset. Re-seeds the text when it changes from
   * outside — the stored values arrive from AsyncStorage a frame after mount. */
  value: number | null;
  /** Fired only with a value the field could actually parse. */
  onChangeValue: (value: number | null) => void;
  /** Drawn inside the field, before the number ("$"). */
  prefix?: string;
  /** Drawn inside the field, after the number ("%", "/mo"). */
  suffix?: string;
  placeholder?: string;
  /** Shown under the field when set — used for "we don't store this" notes. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
};

export function PlannerField({ label, value, onChangeValue, prefix, suffix, placeholder, hint, style }: Props) {
  const theme = useTheme();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  const lastValue = useRef(value);

  // Only re-seed when the value changed somewhere else. Seeding on every render
  // fights the keyboard: typing "12." would be rewritten to "12" mid-entry.
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    setText(value === null ? '' : String(value));
    setInvalid(false);
  }, [value]);

  const change = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setInvalid(false);
      lastValue.current = null;
      onChangeValue(null);
      return;
    }
    const parsed = parseMoneyInput(next);
    // A half-typed number keeps the last good value rather than clearing it —
    // reporting null on every unparseable keystroke wipes the plan while the
    // user is still typing.
    setInvalid(parsed === null);
    if (parsed !== null) {
      lastValue.current = parsed;
      onChangeValue(parsed);
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <Text style={[styles.label, { color: theme.secondaryLabel }]}>{label}</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.fieldBackground,
            borderColor: invalid ? theme.systemRed : 'transparent',
          },
        ]}
      >
        {prefix ? <Text style={[styles.affix, { color: theme.secondaryLabel }]}>{prefix}</Text> : null}
        <TextInput
          style={[styles.input, { color: theme.label }]}
          value={text}
          onChangeText={change}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={theme.tertiaryLabel}
          selectTextOnFocus
          accessibilityLabel={label}
        />
        {suffix ? <Text style={[styles.affix, { color: theme.secondaryLabel }]}>{suffix}</Text> : null}
      </View>
      {invalid ? (
        <Text style={[styles.hint, { color: theme.systemRed }]}>Enter a number</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 130 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 16, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  affix: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 11, marginTop: 4 },
});

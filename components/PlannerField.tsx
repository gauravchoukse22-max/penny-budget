import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, spacing, radius } from '../theme/colors';
import { parseMoneyInput } from '../lib/parse-number';

// The Planner's one input, used for the numbers this screen collects — an
// interest rate, a minimum payment, a goal target — and for its what-if
// amounts. Asking for six of them with hand-rolled TextInputs is where
// inconsistent parsing creeps in.
//
// Parsing goes through parseMoneyInput like every other money field, so "1,500"
// is 1500 and "1e9" is rejected rather than partially parsed.
//
// ── Why it commits on blur, not on keystroke ────────────────────────────────
// The rate and minimum are written straight to the liability row, and every
// such write journals a sync mutation. Firing per keystroke would put six
// journal entries on the queue for typing "19.99" and ship five half-typed
// rates to the other phone. So the value is reported when editing ends.

type Props = {
  label: string;
  /** Current stored value, or null when unset. Re-seeds the text when it
   * changes from outside — rows arrive from the database after mount. */
  value: number | null;
  /** Fired when editing ends, with a parsed value or null for "cleared".
   * Never fired mid-typing — see the note above. */
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
    // Flag junk as it is typed so the field turns red immediately, but report
    // nothing until editing ends.
    setInvalid(next.trim() !== '' && parseMoneyInput(next) === null);
  };

  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      if (lastValue.current === null) return;
      lastValue.current = null;
      onChangeValue(null);
      return;
    }
    const parsed = parseMoneyInput(text);
    if (parsed === null) {
      // Junk left in the field reverts to the stored value rather than wiping
      // it: "1.2.3" is a typo, not an instruction to clear a rate.
      setInvalid(false);
      setText(value === null ? '' : String(value));
      return;
    }
    setInvalid(false);
    if (parsed === lastValue.current) return;
    lastValue.current = parsed;
    onChangeValue(parsed);
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
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
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

import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, radius } from '../theme/colors';

// Cross-platform date input for ISO (YYYY-MM-DD) values.
//
// @react-native-community/datetimepicker renders NOTHING on web — tapping the
// old date chip silently did nothing, so web users could never backdate a
// transaction. On web this renders a real <input type="date"> (via
// react-native-web's createElement so it participates in RN styling); on
// native it keeps the chip + native picker.

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
};

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DateField({ value, onChange }: Props) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === 'web') {
    // Required lazily so the native bundle never touches react-native-web.
    const { unstable_createElement } = require('react-native-web');
    return unstable_createElement('input', {
      type: 'date',
      value,
      onChange: (e: { target: { value: string } }) => {
        // An in-progress edit can momentarily be empty — keep the last date.
        if (e.target.value) onChange(e.target.value);
      },
      style: {
        padding: 12,
        borderRadius: radius.sm,
        backgroundColor: theme.fieldBackground,
        color: theme.label,
        borderWidth: 0,
        fontSize: 14,
        fontFamily: 'inherit',
        colorScheme: scheme === 'dark' ? 'dark' : 'light',
      },
    });
  }

  return (
    <>
      <Pressable style={[styles.dateBox, { backgroundColor: theme.fieldBackground }]} onPress={() => setShowPicker(true)}>
        <Text style={{ color: theme.label }}>{value}</Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={new Date(value + 'T00:00:00')}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selected) => {
            setShowPicker(Platform.OS === 'ios');
            if (selected) onChange(toIso(selected));
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dateBox: { padding: 12, borderRadius: radius.sm },
});

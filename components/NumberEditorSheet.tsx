import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency } from '../lib/format';
import { PressableScale } from './PressableScale';
import { tapLight, tapMedium, success } from '../lib/haptics';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (value: number) => void | Promise<void>;
  title: string;
  subtitle?: string;
  initialValue: number;
  currency?: string;
  /** Quick "+$N" chips. Defaults to a sensible spread. */
  quickAdds?: number[];
  /** Amount each −/+ stepper tap changes the value. */
  step?: number;
};

/**
 * A focused sheet for editing a single money value — big legible number,
 * −/+ steppers, and quick-add chips. Replaces the tiny inline TextInputs so
 * setting a budget feels deliberate rather than like editing a spreadsheet.
 */
export function NumberEditorSheet({
  visible,
  onClose,
  onSave,
  title,
  subtitle,
  initialValue,
  currency = 'USD',
  quickAdds = [10, 50, 100],
  step = 10,
}: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(initialValue));

  // Re-seed the field each time the sheet opens for a fresh row.
  useEffect(() => {
    if (visible) setDraft(initialValue ? String(initialValue) : '');
  }, [visible, initialValue]);

  const numeric = parseFloat(draft) || 0;

  const bump = (delta: number) => {
    const next = Math.max(0, numeric + delta);
    setDraft(String(Number.isInteger(next) ? next : next.toFixed(2)));
    tapLight();
  };

  const commit = async () => {
    tapMedium();
    await onSave(numeric);
    success();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.groupedBackground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[type.headline, { color: theme.label }]}>{title}</Text>
          <Pressable onPress={commit} hitSlop={10}>
            <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>

        {subtitle ? <Text style={[styles.subtitle, { color: theme.tertiaryLabel }]}>{subtitle}</Text> : null}

        <View style={styles.amountArea}>
          <Text style={[styles.preview, { color: theme.tertiaryLabel }]}>{formatCurrency(numeric, currency)}</Text>
          <View style={styles.inputRow}>
            <Text style={[styles.currency, { color: theme.secondaryLabel }]}>$</Text>
            <TextInput
              style={[styles.input, { color: theme.label }]}
              keyboardType="numeric"
              value={draft}
              onChangeText={setDraft}
              placeholder="0"
              placeholderTextColor={theme.tertiaryLabel}
              autoFocus
              selectTextOnFocus
            />
          </View>

          <View style={styles.stepperRow}>
            <PressableScale
              haptic
              onPress={() => bump(-step)}
              style={[styles.stepper, { backgroundColor: theme.fieldBackground }]}
            >
              <Ionicons name="remove" size={24} color={theme.label} />
            </PressableScale>
            <PressableScale
              haptic
              onPress={() => bump(step)}
              style={[styles.stepper, { backgroundColor: theme.fieldBackground }]}
            >
              <Ionicons name="add" size={24} color={theme.label} />
            </PressableScale>
          </View>

          <View style={styles.chipRow}>
            {quickAdds.map((q) => (
              <PressableScale
                key={q}
                haptic
                onPress={() => bump(q)}
                style={[styles.chip, { backgroundColor: theme.accentTint }]}
              >
                <Text style={{ color: theme.accent, fontWeight: '700' }}>+{formatCurrency(q, currency).replace(/\.00$/, '')}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  subtitle: { textAlign: 'center', fontSize: 13, paddingHorizontal: spacing.xl },
  amountArea: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.xl },
  preview: { fontSize: 15, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  currency: { fontSize: 34, fontWeight: '400', marginRight: 4 },
  input: { fontSize: 60, fontWeight: '700', minWidth: 120, textAlign: 'center', padding: 0 },
  stepperRow: { flexDirection: 'row', gap: spacing.lg },
  stepper: { width: 64, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: spacing.xl },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
});

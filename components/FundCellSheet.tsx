import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency, currencySymbol } from '../lib/format';
import { parseMoneyExpression } from '../lib/parse-number';
import { PressableScale } from './PressableScale';
import { tapLight, tapMedium, success } from '../lib/haptics';
import type { FundAdjustMode } from '../features/models';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Receives the FINAL balance for the cell, already combined with the mode. */
  onSave: (nextAmount: number) => void | Promise<void>;
  fundName: string;
  accountName: string;
  currentAmount: number;
  currency?: string;
  quickAdds?: number[];
};

const MODES: Array<{ key: FundAdjustMode; label: string; icon: 'add' | 'remove' | 'create-outline' }> = [
  { key: 'add', label: 'Add', icon: 'add' },
  { key: 'subtract', label: 'Subtract', icon: 'remove' },
  { key: 'set', label: 'Set to', icon: 'create-outline' },
];

/**
 * Edits one cell of the Funds grid.
 *
 * Defaults to Add because the whole point of a fund is that money keeps going
 * into it — typing the new total every time means doing the arithmetic in your
 * head first, which is exactly what the spreadsheet made people do.
 */
export function FundCellSheet({
  visible,
  onClose,
  onSave,
  fundName,
  accountName,
  currentAmount,
  currency = 'USD',
  quickAdds = [100, 500, 1000],
}: Props) {
  const theme = useTheme();
  const [mode, setMode] = useState<FundAdjustMode>('add');
  const [draft, setDraft] = useState('');

  // Re-seed on each open so a cell never inherits the previous cell's entry.
  useEffect(() => {
    if (visible) {
      setMode('add');
      setDraft('');
    }
  }, [visible, fundName, accountName]);

  // The amount typed is always positive — the mode carries the sign — so an
  // expression like "500-600" is rejected rather than quietly flipping to Add.
  const entered = parseMoneyExpression(draft);
  const invalid = draft.trim() !== '' && entered === null;
  const amount = entered ?? 0;
  const nextAmount =
    mode === 'set' ? amount : mode === 'subtract' ? Math.round((currentAmount - amount) * 100) / 100 : Math.round((currentAmount + amount) * 100) / 100;
  const changed = nextAmount !== currentAmount;
  const canSave = !invalid && draft.trim() !== '' && changed;

  const bump = (delta: number) => {
    const base = entered ?? 0;
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setDraft(String(Number.isInteger(next) ? next : next.toFixed(2)));
    tapLight();
  };

  const commit = async () => {
    if (!canSave) return;
    tapMedium();
    await onSave(nextAmount);
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
          <Text style={[type.headline, { color: theme.label }]} numberOfLines={1}>
            {fundName}
          </Text>
          <Pressable onPress={commit} hitSlop={10} disabled={!canSave}>
            <Text style={{ color: canSave ? theme.accent : theme.tertiaryLabel, fontSize: 16, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>

        <Text style={[styles.subtitle, { color: theme.tertiaryLabel }]}>
          {accountName} · now {formatCurrency(currentAmount, currency)}
        </Text>

        <View style={styles.segment}>
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <PressableScale
                key={m.key}
                haptic
                onPress={() => setMode(m.key)}
                style={[styles.segmentItem, { backgroundColor: active ? theme.accent : theme.fieldBackground }]}
              >
                <Ionicons name={m.icon} size={16} color={active ? theme.onAccent : theme.secondaryLabel} />
                <Text style={{ color: active ? theme.onAccent : theme.secondaryLabel, fontWeight: '700', fontSize: 13 }}>
                  {m.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        <View style={styles.amountArea}>
          <View style={styles.inputRow}>
            <Text style={[styles.currency, { color: theme.secondaryLabel }]}>{currencySymbol(currency)}</Text>
            <TextInput
              style={[styles.input, { color: invalid ? theme.systemRed : theme.label }]}
              // Not "numeric": Android's number pad filters "+" out entirely
              // and only tolerates a leading "−", so "1200+300" would be
              // untypable on the platform the parser exists for. This gives the
              // punctuation pad on iOS and the normal keyboard on Android.
              keyboardType="numbers-and-punctuation"
              value={draft}
              onChangeText={setDraft}
              placeholder="0"
              placeholderTextColor={theme.tertiaryLabel}
              autoFocus
              selectTextOnFocus
              autoCorrect={false}
              onSubmitEditing={commit}
              returnKeyType="done"
            />
          </View>

          <Text style={[styles.preview, { color: invalid ? theme.systemRed : theme.secondaryLabel }]}>
            {invalid
              ? 'Enter an amount, or a sum like 1200+300'
              : `${formatCurrency(currentAmount, currency)} → ${formatCurrency(nextAmount, currency)}`}
          </Text>

          {mode !== 'set' && (
            <View style={styles.chipRow}>
              {quickAdds.map((q) => (
                <PressableScale
                  key={q}
                  haptic
                  onPress={() => bump(q)}
                  style={[styles.chip, { backgroundColor: theme.accentTint }]}
                >
                  <Text style={{ color: theme.accent, fontWeight: '700' }}>
                    +{formatCurrency(q, currency).replace(/\.00$/, '')}
                  </Text>
                </PressableScale>
              ))}
            </View>
          )}

          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            You can type a sum — “1200+300” or “5000-250” — and it works out the total.
          </Text>
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
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  subtitle: { textAlign: 'center', fontSize: 13, paddingHorizontal: spacing.xl },
  segment: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  amountArea: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  currency: { fontSize: 30, fontWeight: '400', marginRight: 4 },
  input: { fontSize: 52, fontWeight: '700', minWidth: 140, textAlign: 'center', padding: 0 },
  preview: { fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.xl },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: spacing.xl },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  hint: { fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xxl, lineHeight: 17 },
});

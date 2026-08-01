import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency, currencySymbol } from '../lib/format';
import { parseMoneyExpression } from '../lib/parse-number';
import { PressableScale } from './PressableScale';
import { DatePickerField, toIsoDate } from './DatePickerField';
import { FundEntryRow } from './FundEntryRow';
import { confirmAction } from '../lib/confirm';
import { tapLight, tapMedium, success } from '../lib/haptics';
import type { FundAdjustMode, FundEntry } from '../features/models';

export type FundCellSubmission = {
  mode: FundAdjustMode;
  /** Always positive — `mode` carries the sign. */
  amount: number;
  /** YYYY-MM-DD. */
  date: string;
  note: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Receives what was collected; the caller turns it into a ledger entry. */
  onSave: (submission: FundCellSubmission) => void | Promise<void>;
  onDeleteEntry: (entry: FundEntry) => void | Promise<void>;
  fundName: string;
  accountName: string;
  currentAmount: number;
  /** This cell's entries, newest first. */
  entries: FundEntry[];
  currency?: string;
  quickAdds?: number[];
};

const MODES: Array<{ key: FundAdjustMode; label: string; icon: 'add' | 'remove' | 'create-outline' }> = [
  { key: 'add', label: 'Add', icon: 'add' },
  { key: 'subtract', label: 'Subtract', icon: 'remove' },
  { key: 'set', label: 'Set to', icon: 'create-outline' },
];

// Long enough for "Bonus from March payslip, moved on the 3rd"; short enough
// that a note stays a note and the history list keeps its shape.
const NOTE_MAX = 140;

/**
 * Edits one cell of the Funds grid, and shows what that cell is made of.
 *
 * Defaults to Add because the whole point of a fund is that money keeps going
 * into it — typing the new total every time means doing the arithmetic in your
 * head first, which is exactly what the spreadsheet made people do.
 *
 * The note sits directly under the amount rather than behind a "more" control:
 * in the spreadsheet this replaces, the comment on the cell WAS the record —
 * a deposit with no reason attached is the thing that's useless six months
 * later, so it has to be as easy to type as the number.
 */
export function FundCellSheet({
  visible,
  onClose,
  onSave,
  onDeleteEntry,
  fundName,
  accountName,
  currentAmount,
  entries,
  currency = 'USD',
  quickAdds = [100, 500, 1000],
}: Props) {
  const theme = useTheme();
  const [mode, setMode] = useState<FundAdjustMode>('add');
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => toIsoDate(new Date()));

  // Re-seed on each open so a cell never inherits the previous cell's entry.
  useEffect(() => {
    if (visible) {
      setMode('add');
      setDraft('');
      setNote('');
      setDate(toIsoDate(new Date()));
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
    // A "Set to" lands in the ledger as the DIFFERENCE, so an unexplained
    // "−800" in the history would be unreadable six months later. Fall back to
    // recording what was actually asked for. Add/Subtract need no such crutch:
    // the amount is the thing that happened.
    const typed = note.trim();
    const fallback = mode === 'set' ? `Set to ${formatCurrency(amount, currency)}` : null;
    await onSave({ mode, amount, date, note: typed || fallback });
    success();
    onClose();
  };

  const removeEntry = async (entry: FundEntry) => {
    const ok = await confirmAction({
      title: 'Remove this entry?',
      message: 'It stops counting toward this fund straight away.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await onDeleteEntry(entry);
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

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                returnKeyType="next"
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

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>NOTE</Text>
            <TextInput
              style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              value={note}
              onChangeText={setNote}
              placeholder={mode === 'subtract' ? 'e.g. Moved to the house deposit' : 'e.g. March bonus, monthly transfer'}
              placeholderTextColor={theme.tertiaryLabel}
              maxLength={NOTE_MAX}
              multiline
              returnKeyType="done"
              blurOnSubmit
            />
            <Text style={[styles.fieldHint, { color: theme.tertiaryLabel }]}>
              Why this money moved. It's what you'll be reading months from now.
            </Text>

            <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>DATE</Text>
            <DatePickerField value={date} onChange={setDate} />
            <Text style={[styles.fieldHint, { color: theme.tertiaryLabel }]}>
              Backdate it if the transfer actually happened in an earlier month.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>History</Text>
            {entries.length === 0 ? (
              <Text style={[styles.fieldHint, { color: theme.tertiaryLabel, marginTop: spacing.xs }]}>
                Nothing here yet. Whatever you add now becomes the first entry.
              </Text>
            ) : (
              entries.map((entry) => (
                <FundEntryRow key={entry.id} entry={entry} currency={currency} onDelete={removeEntry} />
              ))
            )}
          </View>
        </ScrollView>
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
  body: { paddingBottom: spacing.xxxl },
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
  amountArea: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  currency: { fontSize: 30, fontWeight: '400', marginRight: 4 },
  input: { fontSize: 52, fontWeight: '700', minWidth: 140, textAlign: 'center', padding: 0 },
  preview: { fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.xl },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: spacing.xl },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  hint: { fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xxl, lineHeight: 17 },
  card: { marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.sm },
  noteInput: { padding: spacing.md, borderRadius: radius.sm, fontSize: 15, minHeight: 68, textAlignVertical: 'top' },
  fieldHint: { fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
});

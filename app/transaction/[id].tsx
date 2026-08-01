import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform, Modal, useColorScheme } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';
import { DateField } from '../../components/DateField';
import { confirmAction } from '../../lib/confirm';
import { currencySymbol, formatDayLabel } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';

// Matches the add-transaction screen so both screens' buttons are the same
// size; 52 clears Apple's 44pt minimum tap target.
const ACTION_HEIGHT = 52;

// iOS' inline calendar has no intrinsic height inside a sheet — this fits a
// full six-row month plus its month header without scrolling.
const INLINE_PICKER_HEIGHT = 380;

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Date row plus a picker that can actually be dismissed.
 *
 * iOS' inline picker draws no chrome of its own, so once mounted there was no
 * way to put it away — it sat under the field for the rest of the session.
 * Presenting it in the app's standard pageSheet (same shape as
 * NumberEditorSheet) gives it a Cancel/Done header, and holding the selection
 * in a draft means backing out leaves the committed date alone. Android's
 * picker is a native dialog that dismisses itself, so it stays inline there.
 */
function DatePickerField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // This screen fills its fields from an effect, so `value` is empty for the
  // first frame — fall back to today rather than rendering "Invalid Date".
  const iso = value || toIso(new Date());

  // Web has no native picker at all — DateField renders a real <input
  // type="date"> there, so hand off rather than duplicate that branch.
  if (Platform.OS === 'web') return <DateField value={iso} onChange={onChange} />;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Date: ${formatDayLabel(iso)}`}
        style={[styles.dateBox, { backgroundColor: theme.fieldBackground }]}
        onPress={() => {
          // Always reopen on the committed date, never a stale draft.
          setDraft(iso);
          setOpen(true);
        }}
      >
        <Text style={{ color: theme.label, fontSize: 15 }}>{formatDayLabel(iso)}</Text>
        <Ionicons name="calendar-outline" size={18} color={theme.secondaryLabel} />
      </Pressable>

      {Platform.OS === 'android' && open && (
        <DateTimePicker
          value={new Date(`${iso}T00:00:00`)}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            // The dialog has already closed itself by the time this fires;
            // unmount it so the next tap opens a fresh one.
            setOpen(false);
            if (event.type === 'set' && selected) onChange(toIso(selected));
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
            <View style={styles.sheetHeader}>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Text style={[type.headline, { color: theme.label }]}>Date</Text>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={new Date(`${draft}T00:00:00`)}
              mode="date"
              display="inline"
              accentColor={theme.accent}
              themeVariant={scheme === 'dark' ? 'dark' : 'light'}
              style={styles.inlinePicker}
              onChange={(_, selected) => {
                if (selected) setDraft(toIso(selected));
              }}
            />
          </View>
        </Modal>
      )}
    </>
  );
}

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, settings, editTransaction, removeTransaction } = useBudget();

  const transaction = transactions.find((t) => t.id === id);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [isRefund, setIsRefund] = useState(false);

  useEffect(() => {
    if (transaction) {
      setAmount(String(Math.abs(transaction.amount)));
      setIsRefund(transaction.amount < 0);
      setNote(transaction.note ?? '');
      setDate(transaction.date);
      setCategoryId(transaction.categoryId);
      setCardId(transaction.cardId);
    }
  }, [transaction?.id]);

  if (!transaction) {
    return (
      <View style={[styles.content, { backgroundColor: theme.groupedBackground }]}>
        <Text style={{ color: theme.tertiaryLabel }}>Transaction not found</Text>
      </View>
    );
  }

  const parsedAmount = parseMoneyInput(amount);
  const canSave = parsedAmount !== null && parsedAmount > 0 && !!cardId;

  const save = async () => {
    if (!canSave || !cardId || parsedAmount === null) return;
    const signedAmount = (isRefund ? -1 : 1) * parsedAmount;
    await editTransaction(transaction.id, { amount: signedAmount, date, categoryId, cardId, note: note.trim() || null });
    router.back();
  };

  const confirmDelete = async () => {
    if (await confirmAction({ title: 'Delete transaction?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
      await removeTransaction(transaction.id);
      router.back();
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // The numeric pad has no Return key, so dragging is the only way out of it.
      keyboardDismissMode="on-drag"
      // Lets iOS inset by the real keyboard height. KeyboardAvoidingView was
      // guessing a 90pt header offset, which is wrong inside a modal
      // presentation and left the buttons under the keyboard.
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.amountRow}>
        <Text style={[styles.currencySymbol, { color: isRefund ? theme.systemGreen : theme.secondaryLabel }]}>
          {isRefund ? '+' : currencySymbol(settings.currency)}
        </Text>
        <TextInput
          style={[styles.amountInput, { color: isRefund ? theme.systemGreen : theme.label }]}
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />
      </View>

      <View style={styles.typeRow}>
        <Pressable
          onPress={() => setIsRefund(false)}
          style={[styles.typeChip, { backgroundColor: !isRefund ? theme.accent : theme.fieldBackground }]}
        >
          <Text style={{ color: !isRefund ? '#FFF' : theme.secondaryLabel, fontWeight: '700' }}>Expense</Text>
        </Pressable>
        <Pressable
          onPress={() => setIsRefund(true)}
          style={[styles.typeChip, { backgroundColor: isRefund ? theme.systemGreen : theme.fieldBackground }]}
        >
          <Text style={{ color: isRefund ? '#FFF' : theme.secondaryLabel, fontWeight: '700' }}>Refund / Credit</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Category</Text>
      <View style={styles.grid}>
        {categories.map((c) => (
          <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={styles.gridItem}>
            <View style={[styles.iconWrap, categoryId === c.id && { borderColor: c.color, borderWidth: 2 }]}>
              <CategoryIcon icon={c.icon} color={c.color} />
            </View>
            <Text style={[styles.gridLabel, { color: theme.secondaryLabel }]} numberOfLines={1}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Card</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardRow}>
        {cards.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setCardId(c.id)}
            style={[styles.cardChip, { backgroundColor: c.color, opacity: cardId === c.id ? 1 : 0.4 }]}
          >
            <Text style={styles.cardChipText}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Date</Text>
      <DatePickerField value={date} onChange={setDate} />

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Note</Text>
      <TextInput
        style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
        value={note}
        onChangeText={setNote}
      />

      <View style={styles.actions}>
        <Pressable
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={[styles.actionButton, styles.actionPrimary, { backgroundColor: theme.accent }, !canSave && styles.actionDisabled]}
          onPress={save}
        >
          <Text style={[type.headline, { color: theme.onAccent }]}>Save Changes</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.actionButton, { borderColor: theme.systemRed }]}
          onPress={confirmDelete}
        >
          <Text style={[type.headline, { color: theme.systemRed }]}>Delete Transaction</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: 8, paddingBottom: 60 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  currencySymbol: { fontSize: 32, fontWeight: '400', marginRight: 4 },
  amountInput: { fontSize: 52, fontWeight: '700', minWidth: 140, textAlign: 'center' },
  typeRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: spacing.md },
  typeChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { alignItems: 'center', width: 72 },
  iconWrap: { borderRadius: 22, padding: 2 },
  gridLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  cardRow: { flexDirection: 'row' },
  cardChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, marginRight: 8 },
  cardChipText: { color: '#FFF', fontWeight: '600' },
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  dateBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: radius.sm },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  inlinePicker: { height: INLINE_PICKER_HEIGHT, marginHorizontal: spacing.sm },
  actions: { gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border box — without it the outlined Delete
  // button sat 3pt taller than the filled Save button.
  actionButton: { height: ACTION_HEIGHT, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: 'transparent' },
  actionDisabled: { opacity: 0.4 },
});

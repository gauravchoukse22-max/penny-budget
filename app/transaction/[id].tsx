import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';
import { DatePickerField } from '../../components/DatePickerField';
import { confirmAction } from '../../lib/confirm';
import { currencySymbol } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';

// Matches the add-transaction screen so both screens' buttons are the same
// size; 52 clears Apple's 44pt minimum tap target.
const ACTION_HEIGHT = 52;

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
  actions: { gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border box — without it the outlined Delete
  // button sat 3pt taller than the filled Save button.
  actionButton: { height: ACTION_HEIGHT, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: 'transparent' },
  actionDisabled: { opacity: 0.4 },
});

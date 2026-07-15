import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, editTransaction, removeTransaction } = useBudget();

  const transaction = transactions.find((t) => t.id === id);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
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

  const canSave = parseFloat(amount) > 0 && !!cardId;

  const save = async () => {
    if (!canSave || !cardId) return;
    const signedAmount = (isRefund ? -1 : 1) * parseFloat(amount);
    await editTransaction(transaction.id, { amount: signedAmount, date, categoryId, cardId, note: note.trim() || null });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeTransaction(transaction.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.amountRow}>
        <Text style={[styles.currencySymbol, { color: isRefund ? theme.systemGreen : theme.secondaryLabel }]}>
          {isRefund ? '+' : '$'}
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
      <Pressable style={[styles.dateBox, { backgroundColor: theme.fieldBackground }]} onPress={() => setShowDatePicker(true)}>
        <Text style={{ color: theme.label }}>{date}</Text>
      </Pressable>
      {showDatePicker && (
        <DateTimePicker
          value={new Date(date + 'T00:00:00')}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selected) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (selected) {
              const d = selected;
              setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }
          }}
        />
      )}

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Note</Text>
      <TextInput
        style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
        value={note}
        onChangeText={setNote}
      />

      <Pressable disabled={!canSave} style={[styles.button, { backgroundColor: theme.accent, opacity: canSave ? 1 : 0.4, marginTop: spacing.xl }]} onPress={save}>
        <Text style={{ color: '#FFF', fontWeight: '600' }}>Save Changes</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.deleteButton, { borderColor: theme.systemRed }]} onPress={confirmDelete}>
        <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Delete Transaction</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
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
  dateBox: { padding: 12, borderRadius: radius.sm },
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  button: { paddingVertical: 15, borderRadius: radius.md, alignItems: 'center' },
  deleteButton: { borderWidth: 1.5, marginTop: 12 },
});

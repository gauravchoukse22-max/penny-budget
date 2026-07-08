import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AddTransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, addTransaction } = useBudget();

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);

  if (cards.length === 0) {
    return (
      <View style={[styles.emptyState, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="card-outline" size={40} color={theme.tertiaryLabel} />
        <Text style={[styles.emptyTitle, { color: theme.label }]}>Add a card first</Text>
        <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
          Every transaction needs a card to belong to. Add one in the Cards tab, then come back here.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.accent, marginTop: spacing.xl }]}
          onPress={() => {
            router.back();
            router.push('/(tabs)/cards');
          }}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>Go to Cards</Text>
        </Pressable>
      </View>
    );
  }

  const canSave = parseFloat(amount) > 0 && !!cardId;

  const save = async (addAnother: boolean) => {
    if (!canSave || !cardId) return;
    await addTransaction({ amount: parseFloat(amount), date, categoryId, cardId, note: note.trim() || null });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (addAnother) {
      setAmount('');
      setNote('');
    } else {
      router.back();
    }
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
        <Text style={[styles.currencySymbol, { color: theme.secondaryLabel }]}>$</Text>
        <TextInput
          style={[styles.amountInput, { color: theme.label }]}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.tertiaryLabel}
          value={amount}
          onChangeText={setAmount}
          autoFocus
        />
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
        placeholder="Merchant / description (optional)"
        placeholderTextColor={theme.tertiaryLabel}
        value={note}
        onChangeText={setNote}
      />

      <View style={styles.buttonRow}>
        <Pressable
          disabled={!canSave}
          style={[styles.button, styles.secondaryButton, { borderColor: theme.accent, opacity: canSave ? 1 : 0.4 }]}
          onPress={() => save(true)}
        >
          <Text style={{ color: theme.accent, fontWeight: '600' }}>Save & Add Another</Text>
        </Pressable>
        <Pressable
          disabled={!canSave}
          style={[styles.button, { backgroundColor: theme.accent, opacity: canSave ? 1 : 0.4 }]}
          onPress={() => save(false)}
        >
          <Text style={{ color: '#FFF', fontWeight: '600' }}>Save</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: 8, paddingBottom: 60 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  currencySymbol: { fontSize: 32, fontWeight: '400', marginRight: 4 },
  amountInput: { fontSize: 52, fontWeight: '700', minWidth: 140, textAlign: 'center' },
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
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: spacing.xl },
  button: { flex: 1, paddingVertical: 15, borderRadius: radius.md, alignItems: 'center' },
  secondaryButton: { borderWidth: 1.5 },
});

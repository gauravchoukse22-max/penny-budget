import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { WalletCard } from '../../components/WalletCard';
import { TransactionRow } from '../../components/TransactionRow';
import { Surface } from '../../components/Surface';
import { daysUntilDue } from '../../lib/queries';

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, transactions, categories, settings, editCard, removeCard } = useBudget();

  const card = cards.find((c) => c.id === id);
  const [nameDraft, setNameDraft] = useState(card?.name ?? '');
  const [billDayDraft, setBillDayDraft] = useState(card?.billDay ? String(card.billDay) : '');
  const [dueDayDraft, setDueDayDraft] = useState(card?.dueDay ? String(card.dueDay) : '');

  if (!card) {
    return (
      <View style={[styles.content, { backgroundColor: theme.groupedBackground }]}>
        <Text style={{ color: theme.tertiaryLabel }}>Card not found</Text>
      </View>
    );
  }

  const cardTransactions = transactions.filter((t) => t.cardId === card.id);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const dueIn = daysUntilDue(card.dueDay);

  const parseDay = (text: string): number | null => {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) return null;
    return n;
  };
  const saveBillDay = () => editCard(card.id, { billDay: parseDay(billDayDraft) });
  const saveDueDay = () => editCard(card.id, { dueDay: parseDay(dueDayDraft) });

  const confirmDelete = () => {
    Alert.alert('Delete card?', 'This permanently deletes the card and every transaction on it, across all months. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeCard(card.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content}>
      <WalletCard card={card} total={cardTotals.get(card.id) ?? 0} currency={settings.currency} />

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Nickname</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          value={nameDraft}
          onChangeText={setNameDraft}
          onBlur={() => editCard(card.id, { name: nameDraft })}
        />
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Billing</Text>
        <View style={styles.billingRow}>
          <View style={styles.billingField}>
            <Text style={[styles.billingLabel, { color: theme.secondaryLabel }]}>Statement day</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="e.g. 20"
              placeholderTextColor={theme.tertiaryLabel}
              value={billDayDraft}
              onChangeText={setBillDayDraft}
              onBlur={saveBillDay}
            />
          </View>
          <View style={styles.billingField}>
            <Text style={[styles.billingLabel, { color: theme.secondaryLabel }]}>Due day</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="e.g. 27"
              placeholderTextColor={theme.tertiaryLabel}
              value={dueDayDraft}
              onChangeText={setDueDayDraft}
              onBlur={saveDueDay}
            />
          </View>
        </View>
        {dueIn !== null && (
          <Text style={[styles.dueHint, { color: dueIn <= 5 ? theme.systemRed : theme.tertiaryLabel }]}>
            {dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
          </Text>
        )}
      </Surface>

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>This Month&apos;s Transactions</Text>
        {cardTransactions.length === 0 ? (
          <Text style={{ color: theme.tertiaryLabel }}>No transactions</Text>
        ) : (
          cardTransactions.map((t) => (
            <TransactionRow
              key={t.id}
              transaction={t}
              category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
              card={card}
              currency={settings.currency}
              onPress={() => router.push(`/transaction/${t.id}`)}
            />
          ))
        )}
      </Surface>

      <Pressable style={[styles.deleteButton, { borderColor: theme.systemRed }]} onPress={confirmDelete}>
        <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Remove Card</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  billingRow: { flexDirection: 'row', gap: spacing.md },
  billingField: { flex: 1, gap: 6 },
  billingLabel: { fontSize: 12, fontWeight: '600' },
  dueHint: { fontSize: 12, marginTop: 10, fontWeight: '600' },
  deleteButton: { borderWidth: 1.5, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});

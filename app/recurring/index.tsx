import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { CategoryIcon } from '../../components/CategoryIcon';
import { AmountText } from '../../components/AmountText';
import { Button, Chip, IconButton } from '../../components/Button';
import {
  listRecurringTransactions,
  createRecurringTransaction,
  deleteRecurringTransaction,
  toggleRecurringTransaction,
  discoverRecurringPatterns,
} from '../../features/recurring-transactions';
import type { RecurringTransaction } from '../../features/models';
import { confirmAction, notify } from '../../lib/confirm';
import { parseMoneyInput } from '../../lib/parse-number';

export default function RecurringScreen() {
  const theme = useTheme();
  const { categories, cards, settings, refresh } = useBudget();

  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof discoverRecurringPatterns>>>([]);

  const load = useCallback(async () => {
    setItems(await listRecurringTransactions());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
    if (!cardId && cards[0]) setCardId(cards[0].id);
  }, [categories, cards, categoryId, cardId]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const dayNum = Math.max(1, Math.min(31, parseInt(day, 10) || 1));
  const parsedAmount = parseMoneyInput(amount);
  const canAdd = note.trim().length > 0 && parsedAmount !== null && parsedAmount > 0 && !!cardId;

  const add = async () => {
    if (!canAdd || !cardId || parsedAmount === null) return;
    await createRecurringTransaction({
      note: note.trim(),
      amount: parsedAmount,
      categoryId,
      cardId,
      dayOfMonth: dayNum,
      active: true,
    });
    setNote('');
    setAmount('');
    setDay('1');
    await load();
  };

  // Deleting a bill removes only the rule — every transaction it has already
  // posted stays. It still asks, because the rule is a form the user filled in
  // by hand and nothing on screen would show it had gone missing until a bill
  // silently stopped posting. Both the swipe and the × share this one spec so
  // the two paths can never drift apart.
  const removeConfirm = (item: RecurringTransaction) => ({
    title: `Delete ${item.note}?`,
    message: 'It stops posting automatically. Transactions it already posted are kept.',
  });

  const remove = async (item: RecurringTransaction) => {
    await deleteRecurringTransaction(item.id);
    await load();
  };

  const confirmAndRemove = async (item: RecurringTransaction) => {
    const ok = await confirmAction({ ...removeConfirm(item), confirmLabel: 'Delete', destructive: true });
    if (ok) await remove(item);
  };

  const toggle = async (item: RecurringTransaction) => {
    await toggleRecurringTransaction(item.id, !item.active);
    await load();
  };

  const discover = async () => {
    const existing = new Set(items.map((i) => i.note.trim().toLowerCase()));
    const found = (await discoverRecurringPatterns()).filter((s) => !existing.has(s.note.trim().toLowerCase()));
    if (found.length === 0) {
      notify('No new patterns', 'No repeating monthly charges were found in your transaction history.');
      return;
    }
    setSuggestions(found);
  };

  const acceptSuggestion = async (s: (typeof suggestions)[number]) => {
    await createRecurringTransaction({
      note: s.note,
      amount: s.amount,
      categoryId: categories[0]?.id ?? null,
      cardId: cards[0]?.id ?? cardId ?? '',
      dayOfMonth: s.dayOfMonth,
      active: true,
    });
    setSuggestions((prev) => prev.filter((x) => x !== s));
    await load();
    await refresh();
  };

  if (cards.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="repeat" size={40} color={theme.tertiaryLabel} />
        <Text style={[styles.emptyTitle, { color: theme.label }]}>Add a card first</Text>
        <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
          Recurring bills post to a card each month. Add a card, then set up your bills here.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAwareScreen
      backgroundColor={theme.groupedBackground}
      contentContainerStyle={styles.content}
    >
      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Recurring Bills</Text>
        {items.length === 0 ? (
          <Text style={{ color: theme.tertiaryLabel }}>No recurring bills yet. Add one below.</Text>
        ) : (
          items.map((item) => {
            const cat = item.categoryId ? categoryById.get(item.categoryId) : undefined;
            return (
              <SwipeToDelete
                key={item.id}
                onDelete={() => remove(item)}
                confirm={() => removeConfirm(item)}
                accessibilityLabel={`Delete recurring bill ${item.note}`}
              >
                <View style={styles.row}>
                  {cat ? <CategoryIcon icon={cat.icon} color={cat.color} size={17} /> : <Ionicons name="repeat" size={17} color={theme.tertiaryLabel} />}
                  <View style={styles.rowMiddle}>
                    <Text style={[styles.rowTitle, { color: theme.label }]} numberOfLines={1}>
                      {item.note}
                    </Text>
                    <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                      Day {item.dayOfMonth} · next {item.nextPostDate}
                    </Text>
                  </View>
                  <AmountText amount={item.amount} currency={settings.currency} size={14} weight="semibold" />
                  <Switch value={item.active} onValueChange={() => toggle(item)} style={styles.switch} />
                  <IconButton
                    icon="close"
                    onPress={() => confirmAndRemove(item)}
                    variant="destructive"
                    accessibilityLabel={`Delete recurring bill ${item.note}`}
                  />
                </View>
              </SwipeToDelete>
            );
          })
        )}
        <Button
          label="Discover from history"
          icon="sparkles-outline"
          onPress={discover}
          variant="tonal"
          size="sm"
          style={styles.discoverRow}
        />
      </Surface>

      {suggestions.length > 0 && (
        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Suggested</Text>
          {suggestions.map((s, i) => (
            <View key={`${s.note}-${i}`} style={styles.row}>
              <View style={styles.rowMiddle}>
                <Text style={[styles.rowTitle, { color: theme.label }]} numberOfLines={1}>
                  {s.note}
                </Text>
                <Text style={{ color: theme.tertiaryLabel, fontSize: 12 }}>
                  ~Day {s.dayOfMonth} · {Math.round(s.confidence * 100)}% match
                </Text>
              </View>
              <AmountText amount={s.amount} currency={settings.currency} size={14} weight="semibold" />
              <IconButton
                icon="add"
                onPress={() => acceptSuggestion(s)}
                variant="tonal"
                accessibilityLabel={`Add ${s.note} as a recurring bill`}
              />
            </View>
          ))}
        </Surface>
      )}

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Add a Bill</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Name (e.g. Netflix)"
          placeholderTextColor={theme.tertiaryLabel}
          value={note}
          onChangeText={setNote}
        />
        <View style={styles.inlineRow}>
          <TextInput
            style={[styles.input, styles.flex1, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Amount"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />
          <TextInput
            style={[styles.input, styles.dayInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Day"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={day}
            onChangeText={setDay}
          />
        </View>

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Category</Text>
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

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Card</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {cards.map((c) => (
            <Chip key={c.id} label={c.name} selected={cardId === c.id} onPress={() => setCardId(c.id)} style={styles.cardChip} selectedColor={c.color} />
          ))}
        </ScrollView>

        <Button label="Add Recurring Bill" onPress={add} variant="primary" disabled={!canAdd} style={styles.addButton} />
      </Surface>

      <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
        Bills post automatically each month when the app is opened on or after their day.
      </Text>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowMiddle: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '500' },
  switch: { transform: [{ scale: 0.8 }] },
  discoverRow: { alignSelf: 'flex-start', marginTop: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginBottom: 10 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  dayInput: { width: 80 },
  fieldLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { alignItems: 'center', width: 72 },
  iconWrap: { borderRadius: 22, padding: 2 },
  gridLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  cardChip: { marginRight: 8 },
  addButton: { marginTop: spacing.lg },
  footer: { textAlign: 'center', fontSize: 12 },
});

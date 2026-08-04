import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { CategoryIcon } from '../../components/CategoryIcon';
import { AmountText } from '../../components/AmountText';
import { PressableScale } from '../../components/PressableScale';
import { Button, IconButton } from '../../components/Button';
import {
  listRecurringTransactions,
  createRecurringTransaction,
  deleteRecurringTransaction,
  toggleRecurringTransaction,
  discoverRecurringPatterns,
} from '../../features/recurring-transactions';
import { suggestCategory } from '../../features/smart-categorizer';
import type { RecurringTransaction, SmartSuggestion } from '../../features/models';
import { confirmAction, notify } from '../../lib/confirm';
import { currencySymbol } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';
import { tapLight } from '../../lib/haptics';

// The Add-a-Bill form is deliberately the Add Transaction screen's layout with
// the calendar question swapped: same big centred amount, same colour-disc
// category chips, same mini wallet-card chips, and "repeats on" chips standing
// where the Today/Yesterday date chips stand. A bill IS a transaction that
// posts itself, and the first version of this form looked nothing like the
// screen users already knew — small grey fields and an icon grid — so adding a
// bill felt like a different app. The styles below are copied from
// app/transaction/add.tsx on purpose; if that screen's language changes, this
// one should change with it.

export default function RecurringScreen() {
  const theme = useTheme();
  const { categories, cards, transactions, settings, refresh } = useBudget();

  // Most-used first, and most-used is the DEFAULT — same rule as the
  // transaction screen: every control below the amount is a correction, not a
  // requirement.
  const sortedCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transactions) {
      if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    }
    return [...categories].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [categories, transactions]);

  const sortedCards = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transactions) counts.set(t.cardId, (counts.get(t.cardId) ?? 0) + 1);
    return [...cards].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [cards, transactions]);

  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [showDayInput, setShowDayInput] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(sortedCategories[0]?.id ?? null);
  const [cardId, setCardId] = useState<string | null>(sortedCards[0]?.id ?? null);
  const [suggestion, setSuggestion] = useState<SmartSuggestion | null>(null);
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
    if (!categoryId && sortedCategories[0]) setCategoryId(sortedCategories[0].id);
    if (!cardId && sortedCards[0]) setCardId(sortedCards[0].id);
  }, [sortedCategories, sortedCards, categoryId, cardId]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const dayNum = Math.max(1, Math.min(31, parseInt(day, 10) || 1));
  const parsedAmount = parseMoneyInput(amount);
  const canAdd = note.trim().length > 0 && parsedAmount !== null && parsedAmount > 0 && !!cardId;

  // Same learning loop as the transaction screen's note field: typing
  // "Netflix" should offer Internet & Subscriptions here too — a bill's name
  // is the best categorisation signal the form has.
  const suggestFromNote = async () => {
    const text = note.trim();
    if (text.length < 2) {
      setSuggestion(null);
      return;
    }
    const s = await suggestCategory(text);
    setSuggestion(s && s.categoryId !== categoryId ? s : null);
  };
  const suggestedCategory = suggestion ? categories.find((c) => c.id === suggestion.categoryId) : undefined;

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
    setShowDayInput(false);
    setSuggestion(null);
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

  // Which "repeats on" chip is lit. A custom day that happens to BE 1/15/31
  // still lights the matching preset — the number is what matters, not how it
  // was entered.
  const isFirst = dayNum === 1 && !showDayInput;
  const isFifteenth = dayNum === 15 && !showDayInput;
  const isLast = dayNum === 31 && !showDayInput;
  const isCustom = showDayInput || (!isFirst && !isFifteenth && !isLast);

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

        {/* The amount leads, exactly as it does on Add Transaction. No
            autofocus, though — this form sits below the bills list, and a
            keyboard that leaps up on tab-open would bury the list the user
            came to read. */}
        <View style={styles.amountRow}>
          <Text style={[styles.currencySymbol, { color: theme.secondaryLabel }]}>
            {currencySymbol(settings.currency)}
          </Text>
          <TextInput
            style={[styles.amountInput, { color: theme.label }]}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={theme.tertiaryLabel}
            value={amount}
            onChangeText={setAmount}
            accessibilityLabel="Bill amount"
          />
        </View>

        <Text style={[styles.label, { color: theme.secondaryLabel }]}>Category</Text>
        <ScrollView horizontal showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {sortedCategories.map((c) => {
            const selected = categoryId === c.id;
            return (
              <PressableScale
                key={c.id}
                haptic
                activeScale={0.94}
                onPress={() => setCategoryId(c.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.chip, styles.iconChip, { backgroundColor: selected ? c.color : theme.fieldBackground }]}
              >
                <View style={[styles.chipDisc, { backgroundColor: selected ? '#FFFFFF' : c.color }]}>
                  <CategoryIcon plain icon={c.icon} color={selected ? c.color : '#FFFFFF'} size={13} />
                </View>
                <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : theme.label }]} numberOfLines={1}>
                  {c.name}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>

        {cards.length > 1 && (
          <>
            <Text style={[styles.label, { color: theme.secondaryLabel }]}>Card</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {sortedCards.map((c) => {
                const selected = cardId === c.id;
                return (
                  <PressableScale
                    key={c.id}
                    haptic
                    activeScale={0.94}
                    onPress={() => setCardId(c.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.chip, styles.iconChip, { backgroundColor: selected ? theme.accent : theme.fieldBackground }]}
                  >
                    <View style={[styles.cardMini, { backgroundColor: c.color }]}>
                      <View style={styles.cardMiniStripe} />
                    </View>
                    <Text style={[styles.chipText, { color: selected ? theme.onAccent : theme.label }]} numberOfLines={1}>
                      {c.name}
                      {c.lastFour ? <Text style={{ fontWeight: '400', opacity: 0.7 }}>{`  ·${c.lastFour}`}</Text> : null}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Where Add Transaction asks WHEN it happened, a bill asks when it
            REPEATS — same chip row, same slot in the form. "Last day" stores
            31; the scheduler clamps it to each month's real end (Feb 28,
            Apr 30), which is what "last day" means. */}
        <Text style={[styles.label, { color: theme.secondaryLabel }]}>Repeats on</Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => {
              tapLight();
              setDay('1');
              setShowDayInput(false);
            }}
            style={[styles.chip, { backgroundColor: isFirst ? theme.accent : theme.fieldBackground }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isFirst }}
          >
            <Text style={[styles.chipText, { color: isFirst ? theme.onAccent : theme.label }]}>The 1st</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tapLight();
              setDay('15');
              setShowDayInput(false);
            }}
            style={[styles.chip, { backgroundColor: isFifteenth ? theme.accent : theme.fieldBackground }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isFifteenth }}
          >
            <Text style={[styles.chipText, { color: isFifteenth ? theme.onAccent : theme.label }]}>The 15th</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tapLight();
              setDay('31');
              setShowDayInput(false);
            }}
            style={[styles.chip, { backgroundColor: isLast ? theme.accent : theme.fieldBackground }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isLast }}
          >
            <Text style={[styles.chipText, { color: isLast ? theme.onAccent : theme.label }]}>Last day</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tapLight();
              setShowDayInput((s) => !s);
            }}
            style={[styles.chip, { backgroundColor: isCustom ? theme.accent : theme.fieldBackground }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isCustom }}
          >
            <Ionicons name="calendar-outline" size={14} color={isCustom ? theme.onAccent : theme.secondaryLabel} />
            <Text style={[styles.chipText, { color: isCustom ? theme.onAccent : theme.label }]}>
              {isCustom && !showDayInput ? `Day ${dayNum}` : 'Other'}
            </Text>
          </Pressable>
        </View>
        {showDayInput && (
          <TextInput
            style={[styles.noteInput, styles.dayField, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Day of month (1–31)"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={day}
            onChangeText={setDay}
            accessibilityLabel="Day of month"
          />
        )}

        <Text style={[styles.label, { color: theme.secondaryLabel }]}>Name</Text>
        <TextInput
          style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Netflix, Rent, Gym…"
          placeholderTextColor={theme.tertiaryLabel}
          value={note}
          onChangeText={setNote}
          onBlur={suggestFromNote}
        />
        {suggestion && suggestedCategory && (
          <Pressable
            style={[styles.suggestionChip, { backgroundColor: theme.fieldBackground, borderColor: suggestedCategory.color }]}
            onPress={() => {
              setCategoryId(suggestedCategory.id);
              setSuggestion(null);
            }}
          >
            <Ionicons name="sparkles" size={14} color={suggestedCategory.color} />
            <Text style={{ color: theme.label, fontSize: 13, flex: 1 }}>
              Suggested: <Text style={{ fontWeight: '700' }}>{suggestedCategory.name}</Text>
            </Text>
            <Text style={{ color: suggestedCategory.color, fontWeight: '700', fontSize: 13 }}>Apply</Text>
          </Pressable>
        )}

        <Button
          label="Add Recurring Bill"
          onPress={add}
          variant="primary"
          size="lg"
          full
          disabled={!canAdd}
          style={styles.addButton}
        />
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
  // Everything below is copied from app/transaction/add.tsx so the two forms
  // are visually one screen — see the header comment.
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  currencySymbol: { fontSize: 32, fontWeight: '400', marginRight: 4 },
  amountInput: { fontSize: 56, fontWeight: '700', minWidth: 140, textAlign: 'center' },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  iconChip: { paddingLeft: 8, gap: 7 },
  chipDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMini: {
    width: 26,
    height: 17,
    borderRadius: 4,
    justifyContent: 'flex-end',
    paddingBottom: 3,
    paddingHorizontal: 4,
  },
  cardMiniStripe: {
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  dayField: { marginTop: spacing.sm },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.sm, borderWidth: 1, marginTop: 8 },
  addButton: { marginTop: spacing.xl },
  footer: { textAlign: 'center', fontSize: 12 },
});

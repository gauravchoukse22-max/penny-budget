import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { currencySymbol, formatShortDate } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';
import { DatePickerField, toIsoDate } from '../../components/DatePickerField';
import { CategoryIcon } from '../../components/CategoryIcon';
import { PressableScale } from '../../components/PressableScale';
import { suggestCategory } from '../../features/smart-categorizer';
import { tapLight, success } from '../../lib/haptics';
import type { SmartSuggestion } from '../../features/models';

// The design rule for this screen: the common case is typing ONE number and
// tapping Save. Category, card and date all pre-select to the likeliest answer
// (most-used category, most-used card, today), so every control below the
// amount is a correction, not a requirement. That is why each picker is a
// single compact row instead of a grid — a row you usually don't touch has no
// business taking a third of the screen.

const ACTION_HEIGHT = 52;

function todayIso(): string {
  return toIsoDate(new Date());
}

function yesterdayIso(): string {
  return toIsoDate(new Date(Date.now() - 86400000));
}

export default function AddTransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, transactions, settings, addTransaction } = useBudget();

  // Most-used first, and most-used is also the DEFAULT — the point of knowing
  // what the user reaches for is not having to ask again.
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

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(sortedCategories[0]?.id ?? null);
  const [cardId, setCardId] = useState<string | null>(sortedCards[0]?.id ?? null);
  const [suggestion, setSuggestion] = useState<SmartSuggestion | null>(null);
  const [isRefund, setIsRefund] = useState(false);

  const suggestFromNote = async () => {
    const text = note.trim();
    if (text.length < 2) {
      setSuggestion(null);
      return;
    }
    const s = await suggestCategory(text);
    // Only surface it if it points somewhere other than the current selection.
    setSuggestion(s && s.categoryId !== categoryId ? s : null);
  };

  const suggestedCategory = suggestion ? categories.find((c) => c.id === suggestion.categoryId) : undefined;

  if (cards.length === 0) {
    return (
      <View style={[styles.emptyState, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="card-outline" size={40} color={theme.tertiaryLabel} />
        <Text style={[styles.emptyTitle, { color: theme.label }]}>Add a card first</Text>
        <Text style={[styles.emptyBody, { color: theme.secondaryLabel }]}>
          Every transaction needs a card to belong to. Add one in the Cards tab, then come back here.
        </Text>
        <Pressable
          style={[styles.emptyButton, { backgroundColor: theme.accent }]}
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

  const parsedAmount = parseMoneyInput(amount);
  const canSave = parsedAmount !== null && parsedAmount > 0 && !!cardId;

  const save = async (addAnother: boolean) => {
    if (!canSave || !cardId || parsedAmount === null) return;
    const signedAmount = (isRefund ? -1 : 1) * parsedAmount;
    await addTransaction({ amount: signedAmount, date, categoryId, cardId, note: note.trim() || null });
    success();
    if (addAnother) {
      setAmount('');
      setNote('');
      setIsRefund(false);
    } else {
      router.back();
    }
  };

  const isToday = date === todayIso();
  const isYesterday = date === yesterdayIso();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // The numeric pad has no Return key, so dragging is the only way out of
      // it once the amount field autofocuses.
      keyboardDismissMode="on-drag"
      // Lets iOS inset by the real keyboard height. KeyboardAvoidingView was
      // guessing a 90pt header offset, which is wrong inside a modal
      // presentation and left the Save buttons under the keyboard.
      automaticallyAdjustKeyboardInsets
    >
      {/* Amount + type. The +/− toggle sits with the number it signs, so the
          state it controls is visible in one glance: green +12.34 is a refund. */}
      <View style={styles.amountRow}>
        <Text style={[styles.currencySymbol, { color: isRefund ? theme.systemGreen : theme.secondaryLabel }]}>
          {isRefund ? '+' : currencySymbol(settings.currency)}
        </Text>
        <TextInput
          style={[styles.amountInput, { color: isRefund ? theme.systemGreen : theme.label }]}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor={theme.tertiaryLabel}
          value={amount}
          onChangeText={setAmount}
          autoFocus
          accessibilityLabel="Amount"
        />
      </View>
      <Pressable
        onPress={() => {
          tapLight();
          setIsRefund((r) => !r);
        }}
        style={[styles.refundToggle, { backgroundColor: isRefund ? theme.systemGreen : theme.fieldBackground }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: isRefund }}
        accessibilityLabel="This is a refund or credit"
      >
        <Ionicons name={isRefund ? 'arrow-down-circle' : 'arrow-up-circle-outline'} size={15} color={isRefund ? '#FFF' : theme.secondaryLabel} />
        <Text style={{ color: isRefund ? '#FFF' : theme.secondaryLabel, fontSize: 13, fontWeight: '600' }}>
          {isRefund ? 'Refund / credit' : 'Expense'}
        </Text>
      </Pressable>

      {/* One row per decision, defaults already made. */}
      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
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
              style={[
                styles.chip,
                { backgroundColor: selected ? c.color : theme.fieldBackground },
              ]}
            >
              <CategoryIcon plain icon={c.icon} color={selected ? '#FFFFFF' : c.color} size={15} />
              <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : theme.label }]} numberOfLines={1}>
                {c.name}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* A single card needs no picker at all — the row only exists once there
          is a choice to make. */}
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
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.accent : theme.fieldBackground,
                    },
                  ]}
                >
                  <View style={[styles.cardDot, { backgroundColor: c.color }]} />
                  <Text style={[styles.chipText, { color: selected ? theme.onAccent : theme.label }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </>
      )}

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Date</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => {
            tapLight();
            setDate(todayIso());
            setShowDatePicker(false);
          }}
          style={[styles.chip, { backgroundColor: isToday ? theme.accent : theme.fieldBackground }]}
          accessibilityRole="radio"
          accessibilityState={{ selected: isToday }}
        >
          <Text style={[styles.chipText, { color: isToday ? theme.onAccent : theme.label }]}>Today</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            tapLight();
            setDate(yesterdayIso());
            setShowDatePicker(false);
          }}
          style={[styles.chip, { backgroundColor: isYesterday ? theme.accent : theme.fieldBackground }]}
          accessibilityRole="radio"
          accessibilityState={{ selected: isYesterday }}
        >
          <Text style={[styles.chipText, { color: isYesterday ? theme.onAccent : theme.label }]}>Yesterday</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            tapLight();
            setShowDatePicker((s) => !s);
          }}
          style={[
            styles.chip,
            { backgroundColor: !isToday && !isYesterday ? theme.accent : theme.fieldBackground },
          ]}
          accessibilityRole="radio"
          accessibilityState={{ selected: !isToday && !isYesterday }}
        >
          <Ionicons
            name="calendar-outline"
            size={14}
            color={!isToday && !isYesterday ? theme.onAccent : theme.secondaryLabel}
          />
          <Text style={[styles.chipText, { color: !isToday && !isYesterday ? theme.onAccent : theme.label }]}>
            {!isToday && !isYesterday ? formatShortDate(date) : 'Other'}
          </Text>
        </Pressable>
      </View>
      {showDatePicker && <DatePickerField value={date} onChange={setDate} />}

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Note</Text>
      <TextInput
        style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
        placeholder="Merchant / description (optional)"
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
            {suggestion.source === 'naive_bayes' ? `  (${Math.round(suggestion.confidence * 100)}%)` : ''}
          </Text>
          <Text style={{ color: suggestedCategory.color, fontWeight: '700', fontSize: 13 }}>Apply</Text>
        </Pressable>
      )}

      <View style={styles.actions}>
        <PressableScale
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={[styles.saveButton, { backgroundColor: theme.accent }, !canSave && styles.actionDisabled]}
          onPress={() => save(false)}
        >
          <Text style={[type.headline, { color: theme.onAccent }]}>Save</Text>
        </PressableScale>
        {/* Secondary path as a text button — one obvious Save, not two
            equal-weight boxes competing for the tap. */}
        <Pressable
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          onPress={() => save(true)}
          style={[styles.saveAnother, !canSave && styles.actionDisabled]}
          hitSlop={8}
        >
          <Text style={{ color: theme.accent, fontWeight: '600', fontSize: 15 }}>Save & add another</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 60 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: spacing.md },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  currencySymbol: { fontSize: 32, fontWeight: '400', marginRight: 4 },
  amountInput: { fontSize: 56, fontWeight: '700', minWidth: 140, textAlign: 'center' },
  refundToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  // One height for every chip on the screen; 40pt + vertical hitSlop from the
  // row spacing keeps taps easy without the rows growing into panels.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  cardDot: { width: 10, height: 10, borderRadius: 5 },
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.sm, borderWidth: 1, marginTop: 8 },
  actions: { marginTop: spacing.xxl, gap: spacing.md },
  saveButton: { height: ACTION_HEIGHT, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveAnother: { alignSelf: 'center', paddingVertical: 6 },
  actionDisabled: { opacity: 0.4 },
  emptyButton: {
    height: ACTION_HEIGHT,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
});

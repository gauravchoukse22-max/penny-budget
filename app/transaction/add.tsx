import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { currencySymbol } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';
import { DatePickerField, toIsoDate } from '../../components/DatePickerField';
import { CategoryIcon } from '../../components/CategoryIcon';
import { PressableScale } from '../../components/PressableScale';
import { suggestCategory } from '../../features/smart-categorizer';
import { tapLight, success } from '../../lib/haptics';
import type { SmartSuggestion } from '../../features/models';

// Both action buttons and the empty-state button share one height so the pair
// reads as a set; 52 matches the stepper buttons in NumberEditorSheet and
// clears Apple's 44pt minimum tap target.
const ACTION_HEIGHT = 52;

function todayIso(): string {
  return toIsoDate(new Date());
}

export default function AddTransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, transactions, settings, addTransaction } = useBudget();

  // Surface the categories the user reaches for most, so the common picks sit
  // up top instead of in creation order.
  const sortedCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transactions) {
      if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    }
    return [...categories].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [categories, transactions]);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
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
        />
      </View>

      <View style={styles.typeRow}>
        <Pressable
          onPress={() => {
            tapLight();
            setIsRefund(false);
          }}
          style={[styles.typeChip, { backgroundColor: !isRefund ? theme.accent : theme.fieldBackground }]}
        >
          <Text style={{ color: !isRefund ? '#FFF' : theme.secondaryLabel, fontWeight: '700' }}>Expense</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            tapLight();
            setIsRefund(true);
          }}
          style={[styles.typeChip, { backgroundColor: isRefund ? theme.systemGreen : theme.fieldBackground }]}
        >
          <Text style={{ color: isRefund ? '#FFF' : theme.secondaryLabel, fontWeight: '700' }}>Refund / Credit</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Category</Text>
      <View style={styles.grid}>
        {sortedCategories.map((c) => {
          const selected = categoryId === c.id;
          return (
            <PressableScale
              key={c.id}
              haptic
              activeScale={0.92}
              onPress={() => setCategoryId(c.id)}
              style={styles.gridItem}
            >
              <View style={[styles.iconWrap, { backgroundColor: selected ? c.color : theme.fieldBackground }]}>
                <CategoryIcon icon={c.icon} color={selected ? '#FFFFFF' : c.color} size={22} />
                {selected && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark-circle" size={18} color={c.color} />
                  </View>
                )}
              </View>
              <Text
                style={[styles.gridLabel, { color: selected ? theme.label : theme.secondaryLabel, fontWeight: selected ? '700' : '400' }]}
                numberOfLines={1}
              >
                {c.name}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Card</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardRow}>
        {cards.map((c) => {
          const selected = cardId === c.id;
          return (
            <PressableScale
              key={c.id}
              haptic
              activeScale={0.94}
              onPress={() => setCardId(c.id)}
              style={[
                styles.cardChip,
                { backgroundColor: c.color, opacity: selected ? 1 : 0.5, borderWidth: 2, borderColor: selected ? '#FFFFFF' : 'transparent' },
              ]}
            >
              {selected && <Ionicons name="checkmark" size={15} color="#FFFFFF" style={{ marginRight: 5 }} />}
              <Text style={styles.cardChipText}>{c.name}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Date</Text>
      <DatePickerField value={date} onChange={setDate} />

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
          style={[styles.actionButton, styles.actionPrimary, { backgroundColor: theme.accent }, !canSave && styles.actionDisabled]}
          onPress={() => save(false)}
        >
          <Text style={[type.headline, { color: theme.onAccent }]}>Save</Text>
        </PressableScale>
        <PressableScale
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={[
            styles.actionButton,
            { backgroundColor: theme.accentTint, borderColor: theme.accent },
            !canSave && styles.actionDisabled,
          ]}
          onPress={() => save(true)}
        >
          <Text style={[type.headline, { color: theme.accent }]}>Save & Add Another</Text>
        </PressableScale>
      </View>
    </ScrollView>
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
  typeRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: spacing.md },
  typeChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridItem: { alignItems: 'center', width: 72 },
  iconWrap: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  checkBadge: { position: 'absolute', top: -2, right: -2, backgroundColor: '#FFFFFF', borderRadius: 9 },
  gridLabel: { fontSize: 11, marginTop: 5, textAlign: 'center' },
  cardRow: { flexDirection: 'row' },
  cardChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, marginRight: 8 },
  cardChipText: { color: '#FFF', fontWeight: '600' },
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.sm, borderWidth: 1, marginTop: 8 },
  // Stacked rather than side by side: "Save & Add Another" wrapped to two lines
  // at half width, which is what made the pair look like mismatched shapes.
  actions: { gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border box — without it the outlined one sat
  // 3pt taller than the filled one.
  actionButton: { height: ACTION_HEIGHT, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: 'transparent' },
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

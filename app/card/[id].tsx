import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, CATEGORY_PALETTE } from '../../theme/colors';
import { WalletCard } from '../../components/WalletCard';
import { TransactionRow } from '../../components/TransactionRow';
import { Surface } from '../../components/Surface';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { confirmAction, notify } from '../../lib/confirm';
import { selection } from '../../lib/haptics';
import { countTransactionsForCard, daysUntilDue } from '../../lib/queries';
import { isCashCard } from '../../lib/models';

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, transactions, categories, settings, selectedMonth, editCard, removeCard } = useBudget();

  const card = cards.find((c) => c.id === id);
  const [nameDraft, setNameDraft] = useState(card?.name ?? '');
  const [lastFourDraft, setLastFourDraft] = useState(card?.lastFour ?? '');
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
  const isCash = isCashCard(card.id);

  // Every field below saves on blur and, when the input can't be used, puts the
  // stored value back and says why. The previous version just wrote `null` for
  // anything unparseable, so typing "45" as a due day silently cleared the
  // field — the user saw their number vanish with no idea what was wrong.
  const saveName = () => {
    const next = nameDraft.trim();
    if (!next) {
      // A blank name renders as an unlabelled card that can't be told apart
      // from the others, and there is no undo, so refuse it.
      setNameDraft(card.name);
      notify('A card needs a name', 'Give it something you\'ll recognise — the name is how the card is labelled everywhere.');
      return;
    }
    if (next === card.name) return;
    editCard(card.id, { name: next });
  };

  const saveLastFour = () => {
    const next = lastFourDraft.trim();
    // Empty is allowed on purpose: not every account has four digits worth
    // tracking, and WalletCard already renders that case without the "••••".
    if (next && !/^\d{4}$/.test(next)) {
      setLastFourDraft(card.lastFour);
      notify('Check the last 4 digits', 'Enter exactly 4 numbers, or clear the field to leave them off the card.');
      return;
    }
    if (next === card.lastFour) return;
    editCard(card.id, { lastFour: next });
  };

  const saveDay = (which: 'billDay' | 'dueDay', text: string, reset: (v: string) => void) => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (card[which] !== null) editCard(card.id, { [which]: null });
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      reset(card[which] ? String(card[which]) : '');
      notify('Check that day', 'Use a day of the month between 1 and 31, or clear it if you don\'t track it.');
      return;
    }
    if (n === card[which]) return;
    editCard(card.id, { [which]: n });
  };
  const saveBillDay = () => saveDay('billDay', billDayDraft, setBillDayDraft);
  const saveDueDay = () => saveDay('dueDay', dueDayDraft, setDueDayDraft);

  const setColor = (color: string) => {
    if (color === card.color) return;
    selection();
    editCard(card.id, { color });
  };

  // Counted from the database, not from `cardTransactions` — that list is only
  // the selected month, and the move covers every month the card ever had.
  const confirmDelete = async () => {
    const count = await countTransactionsForCard(card.id);
    const message =
      count === 0
        ? 'This card has no transactions, so nothing else changes.'
        : `Its ${count} transaction${count === 1 ? '' : 's'}, across all months, move to Cash — nothing is deleted. Only the card is removed.`;
    if (await confirmAction({ title: `Delete ${card.name}?`, message, confirmLabel: 'Delete card', destructive: true })) {
      await removeCard(card.id);
      router.back();
    }
  };

  return (
    <KeyboardAwareScreen
      backgroundColor={theme.groupedBackground}
      contentContainerStyle={styles.content}
    >
      <WalletCard card={card} total={cardTotals.get(card.id) ?? 0} currency={settings.currency} yearMonth={selectedMonth} />

      <Surface>
        <Text style={[styles.sectionTitle, { color: theme.label }]}>Card details</Text>

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>NAME</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          value={nameDraft}
          onChangeText={setNameDraft}
          onBlur={saveName}
          maxLength={40}
          accessibilityLabel="Card name"
          returnKeyType="done"
        />

        {/* Cash has no card number, so the field would be a permanently empty
            box on the one card that can never fill it. */}
        {!isCash && (
          <>
            <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>LAST 4 DIGITS</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              value={lastFourDraft}
              onChangeText={(t) => setLastFourDraft(t.replace(/\D/g, ''))}
              onBlur={saveLastFour}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="1234"
              placeholderTextColor={theme.tertiaryLabel}
              accessibilityLabel="Last four digits"
              returnKeyType="done"
            />
            <Text style={[styles.fieldHint, { color: theme.tertiaryLabel }]}>
              Shown on the card so you can tell two similar cards apart. Leave it empty to hide it.
            </Text>
          </>
        )}

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>COLOUR</Text>
        {/* Applies immediately rather than on a Save button: the card sits at
            the top of this screen, so the tap and its result are both on
            screen and picking is a matter of looking, not remembering. */}
        <View style={styles.swatchRow}>
          {CATEGORY_PALETTE.map((c) => {
            const active = c.toLowerCase() === card.color.toLowerCase();
            return (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Card colour ${c}`}
                hitSlop={4}
                style={[
                  styles.swatch,
                  { backgroundColor: c, borderColor: active ? theme.label : 'transparent' },
                ]}
              >
                {active && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
              </Pressable>
            );
          })}
        </View>
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

      {/* Cash has no Remove button. deleteCard refuses the row regardless, so
          showing a button that silently does nothing would only look broken. */}
      {isCash ? (
        <Text style={[styles.cashNote, { color: theme.tertiaryLabel }]}>
          Cash holds spending that isn&apos;t on a card, and anything left behind when a card is
          removed. It can&apos;t be deleted.
        </Text>
      ) : (
        <Pressable style={[styles.deleteButton, { borderColor: theme.systemRed }]} onPress={confirmDelete}>
          <Text style={{ color: theme.systemRed, fontWeight: '600' }}>Remove Card</Text>
        </Pressable>
      )}
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  fieldHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 40pt with hitSlop clears Apple's 44pt minimum without the swatches
  // becoming so large that the row wraps to three lines.
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billingRow: { flexDirection: 'row', gap: spacing.md },
  billingField: { flex: 1, gap: 6 },
  billingLabel: { fontSize: 12, fontWeight: '600' },
  dueHint: { fontSize: 12, marginTop: 10, fontWeight: '600' },
  deleteButton: { borderWidth: 1.5, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  cashNote: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: spacing.md },
});

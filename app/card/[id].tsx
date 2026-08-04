import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type, CATEGORY_PALETTE } from '../../theme/colors';
import { WalletCard } from '../../components/WalletCard';
import { TransactionRow } from '../../components/TransactionRow';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { confirmAction, notify } from '../../lib/confirm';
import { selection } from '../../lib/haptics';
import { countTransactionsForCard, daysUntilDue } from '../../lib/queries';
import { isCashCard } from '../../lib/models';

// Read first, edit deliberately.
//
// This screen used to be a permanently live form: every field was a text box
// that wrote to the database on blur. Three things were wrong with that. You
// could not look at a card without being one stray tap away from changing it;
// there was no point at which you had "finished", so nothing could be validated
// as a whole or undone; and a screen of identical input boxes reads as a form
// to fill in rather than a card to look at.
//
// Now it renders as a detail view with an Edit button, exactly like Contacts:
// Edit turns the fields on, Save validates everything at once and writes it in
// a single change, Cancel puts back what was there. Leaving mid-edit is blocked
// so a half-typed due day can't disappear on a swipe.

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, transactions, categories, settings, selectedMonth, editCard, removeCard } = useBudget();

  const card = cards.find((c) => c.id === id);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(card?.name ?? '');
  const [lastFourDraft, setLastFourDraft] = useState(card?.lastFour ?? '');
  const [billDayDraft, setBillDayDraft] = useState(card?.billDay ? String(card.billDay) : '');
  const [dueDayDraft, setDueDayDraft] = useState(card?.dueDay ? String(card.dueDay) : '');
  const [colorDraft, setColorDraft] = useState(card?.color ?? '');

  // Keep the drafts in step with the stored card while NOT editing — the other
  // person on a shared budget can rename a card underneath this screen, and a
  // stale draft would then quietly overwrite their change on the next save.
  useEffect(() => {
    if (editing || !card) return;
    setNameDraft(card.name);
    setLastFourDraft(card.lastFour);
    setBillDayDraft(card.billDay ? String(card.billDay) : '');
    setDueDayDraft(card.dueDay ? String(card.dueDay) : '');
    setColorDraft(card.color);
  }, [editing, card?.name, card?.lastFour, card?.billDay, card?.dueDay, card?.color]);

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

  const parseDay = (text: string): number | null | 'invalid' => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) return 'invalid';
    return n;
  };

  const dirty =
    nameDraft.trim() !== card.name ||
    lastFourDraft.trim() !== card.lastFour ||
    colorDraft !== card.color ||
    billDayDraft.trim() !== (card.billDay ? String(card.billDay) : '') ||
    dueDayDraft.trim() !== (card.dueDay ? String(card.dueDay) : '');

  /**
   * Validates the whole card, then writes it as ONE change. Saving field by
   * field on blur meant a card could sit in a half-valid state between taps,
   * and a rejected value had already been replaced on screen by the time the
   * message appeared.
   */
  const save = async () => {
    const name = nameDraft.trim();
    if (!name) {
      notify('A card needs a name', "Give it something you'll recognise — the name is how the card is labelled everywhere.");
      return;
    }
    const lastFour = lastFourDraft.trim();
    if (lastFour && !/^\d{4}$/.test(lastFour)) {
      notify('Check the last 4 digits', 'Enter exactly 4 numbers, or clear the field to leave them off the card.');
      return;
    }
    const billDay = parseDay(billDayDraft);
    const dueDay = parseDay(dueDayDraft);
    if (billDay === 'invalid' || dueDay === 'invalid') {
      notify('Check that day', "Use a day of the month between 1 and 31, or clear it if you don't track it.");
      return;
    }

    if (dirty) await editCard(card.id, { name, lastFour, color: colorDraft, billDay, dueDay });
    setEditing(false);
  };

  const cancel = async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: 'Discard changes?',
        message: 'The card goes back to how it was.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        destructive: true,
      });
      if (!ok) return;
    }
    setNameDraft(card.name);
    setLastFourDraft(card.lastFour);
    setBillDayDraft(card.billDay ? String(card.billDay) : '');
    setDueDayDraft(card.dueDay ? String(card.dueDay) : '');
    setColorDraft(card.color);
    setEditing(false);
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

  const previewCard = editing
    ? { ...card, name: nameDraft.trim() || card.name, lastFour: lastFourDraft.trim(), color: colorDraft }
    : card;

  return (
    <>
      <Stack.Screen
        options={{
          title: editing ? 'Edit Card' : card.name,
          // While editing, the only ways off this screen are Save and Cancel —
          // otherwise a back swipe silently throws away what was typed.
          headerBackVisible: !editing,
          gestureEnabled: !editing,
          headerLeft: editing
            ? () => (
                <Pressable onPress={cancel} hitSlop={12} accessibilityRole="button">
                  <Text style={[type.body, { color: theme.accent }]}>Cancel</Text>
                </Pressable>
              )
            : undefined,
          headerRight: () => (
            <Pressable
              onPress={editing ? save : () => setEditing(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Save card' : 'Edit card'}
            >
              <Text style={[type.body, { color: theme.accent, fontWeight: editing ? '700' : '400' }]}>
                {editing ? 'Save' : 'Edit'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAwareScreen backgroundColor={theme.groupedBackground} contentContainerStyle={styles.content}>
        <WalletCard
          card={previewCard}
          total={cardTotals.get(card.id) ?? 0}
          currency={settings.currency}
          yearMonth={selectedMonth}
        />

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Card details</Text>

          {editing ? (
            <>
              <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>NAME</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                value={nameDraft}
                onChangeText={setNameDraft}
                maxLength={40}
                accessibilityLabel="Card name"
                returnKeyType="done"
                autoFocus
              />

              {/* Cash has no card number, so the field would be a permanently
                  empty box on the one card that can never fill it. */}
              {!isCash && (
                <>
                  <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>LAST 4 DIGITS</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
                    value={lastFourDraft}
                    onChangeText={(t) => setLastFourDraft(t.replace(/\D/g, ''))}
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
              <View style={styles.swatchRow}>
                {CATEGORY_PALETTE.map((c) => {
                  const active = c.toLowerCase() === colorDraft.toLowerCase();
                  return (
                    <Pressable
                      key={c}
                      onPress={() => {
                        selection();
                        setColorDraft(c);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Card colour ${c}`}
                      hitSlop={4}
                      style={[styles.swatch, { backgroundColor: c, borderColor: active ? theme.label : 'transparent' }]}
                    >
                      {active && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <DetailRow label="Name" value={card.name} />
              {!isCash && <DetailRow label="Last 4 digits" value={card.lastFour || 'Not set'} muted={!card.lastFour} />}
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: theme.secondaryLabel }]}>Colour</Text>
                <View style={[styles.colorDot, { backgroundColor: card.color }]} />
              </View>
            </>
          )}
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Billing</Text>
          {editing ? (
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
                />
              </View>
            </View>
          ) : (
            <>
              <DetailRow label="Statement day" value={card.billDay ? String(card.billDay) : 'Not set'} muted={!card.billDay} />
              <DetailRow label="Due day" value={card.dueDay ? String(card.dueDay) : 'Not set'} muted={!card.dueDay} />
            </>
          )}
          {dueIn !== null && !editing && (
            <Text style={[styles.dueHint, { color: dueIn <= 5 ? theme.systemRed : theme.tertiaryLabel }]}>
              {dueIn === 0 ? 'Due today' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
            </Text>
          )}
        </Surface>

        {/* The transaction list is noise while editing — the point of edit mode
            is the fields, and the list pushes the Save button's context away. */}
        {!editing && (
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
        )}

        {/* Removing a card is a destructive edit, so it lives inside edit mode —
            the same place Contacts keeps "Delete Contact". Cash has no button
            at all: deleteCard refuses that row regardless, so showing one that
            silently does nothing would only look broken. */}
        {editing && !isCash && (
          <Button label="Remove Card" onPress={confirmDelete} variant="destructive" size="lg" />
        )}
        {editing && isCash && (
          <Text style={[styles.cashNote, { color: theme.tertiaryLabel }]}>
            Cash holds spending that isn&apos;t on a card, and anything left behind when a card is
            removed. It can&apos;t be deleted.
          </Text>
        )}
      </KeyboardAwareScreen>
    </>
  );
}

function DetailRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.secondaryLabel }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: muted ? theme.tertiaryLabel : theme.label }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  fieldHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: spacing.lg,
  },
  detailLabel: { fontSize: 15 },
  detailValue: { fontSize: 15, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
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
  cashNote: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: spacing.md },
});

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, CATEGORY_PALETTE, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { AmountText } from '../../components/AmountText';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { formatMonthLabel, formatCurrency } from '../../lib/format';
import { notify } from '../../lib/confirm';
import { daysUntilDue, countTransactionsForCard } from '../../lib/queries';
import { isCashCard } from '../../lib/models';

export default function CardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { cards, cardTotals, settings, selectedMonth, addCard, removeCard } = useBudget();
  const [showAdd, setShowAdd] = useState(false);

  const monthTotal = cards.reduce((sum, c) => sum + (cardTotals.get(c.id) ?? 0), 0);
  // Cash is seeded, not added, so it shouldn't count toward "3 cards" or claim a
  // slot in the palette rotation a new card picks its color from.
  const realCards = cards.filter((c) => !isCashCard(c.id));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title1, { color: theme.label }]}>Cards</Text>
          {realCards.length > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryText, { color: theme.secondaryLabel }]}>
                {realCards.length} {realCards.length === 1 ? 'card' : 'cards'}
                {'   ·   '}
              </Text>
              <AmountText amount={monthTotal} currency={settings.currency} size={13} color={theme.secondaryLabel} />
              {/* Was "this month", which was wrong the moment you stepped back a
                  month — the totals have always come from selectedMonth. */}
              <Text style={[styles.summaryText, { color: theme.secondaryLabel }]}> in {formatMonthLabel(selectedMonth)}</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => setShowAdd(true)}
          hitSlop={8}
          style={[styles.addButton, { borderColor: theme.separator }]}
        >
          <Ionicons name="add" size={22} color={theme.accent} />
        </Pressable>
      </View>
      <MonthSwitcher style={styles.monthSwitcher} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {realCards.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="card-outline" size={30} color={theme.tertiaryLabel} />
            <Text style={[styles.emptyText, { color: theme.secondaryLabel }]}>
              No cards yet. Add one to track its balance and due date — until then, spending goes on Cash.
            </Text>
          </View>
        )}
        {/* One panel of compact rows instead of a stack of full-height wallet
            cards (owner's pick, "option A") — the whole wallet fits on one
            screen, and the row still carries everything the big card did:
            identity, month total, due date. Padding 0 + overflow hidden so
            rows and their swipe panels run edge to edge and the Surface's
            corner radius clips them. */}
        <Surface style={styles.list}>
          {cards.map((c, i) => {
            const dueIn = daysUntilDue(c.dueDay);
            const dueSoon = dueIn !== null && dueIn <= 5;
            const isCash = isCashCard(c.id);
            const total = cardTotals.get(c.id) ?? 0;
            // The Cash row's status line keeps the old footer caption — it's
            // the one row that isn't a card, and the caption is what explains
            // where card-less spending goes.
            const status = isCash
              ? 'Cash & anything without a card'
              : dueIn === null
                ? 'No due date'
                : dueIn === 0
                  ? 'Due today'
                  : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`;
            // One spoken sentence per row, and it respects Hide Amounts the
            // same way the visible AmountText does — VoiceOver must not leak
            // what the screen is masking.
            const spokenAmount = settings.hideAmounts ? 'amount hidden' : formatCurrency(total, settings.currency);
            const rowLabel = `${c.name}${c.lastFour ? `, ending ${c.lastFour}` : ''}, ${spokenAmount} in ${formatMonthLabel(selectedMonth)}, ${status.toLowerCase()}`;
            return (
              <React.Fragment key={c.id}>
                {/* Hairline lives outside the swipe row so it stays put while
                    the row slides; inset to start where the text does. */}
                {i > 0 && <View style={[styles.hairline, { backgroundColor: theme.separator }]} />}
                {/* Deleting a card no longer destroys its history — the
                    transactions move to Cash. The count is still read at swipe
                    time so the dialog says how much is moving, not a vague
                    "and its transactions".

                    Cash itself has no swipe: deleteCard refuses it anyway, and
                    a delete gesture that quietly does nothing is worse than no
                    gesture. */}
                <SwipeToDelete
                  enabled={!isCash}
                  onDelete={() => removeCard(c.id)}
                  accessibilityLabel={`Delete card ${c.name}`}
                  confirm={async () => {
                    const count = await countTransactionsForCard(c.id);
                    return {
                      title: `Delete ${c.name}?`,
                      message:
                        count === 0
                          ? 'This card has no transactions, so nothing else changes.'
                          : `Its ${count} transaction${count === 1 ? '' : 's'}, across all months, move to Cash — nothing is deleted. Only the card is removed.`,
                      confirmLabel: 'Delete card',
                    };
                  }}
                >
                  <Pressable
                    onPress={() => router.push(`/card/${c.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={rowLabel}
                    // Opaque background, not transparent: the swipe gesture
                    // reveals the red Delete panel from BEHIND this row, so a
                    // see-through row would show it at rest.
                    style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.fieldBackground : theme.card }]}
                  >
                    {/* The same miniature the add-transaction card chips use —
                        colour plus chip stripe — so a card looks identical
                        everywhere it appears, just scaled to the row. */}
                    <View style={[styles.cardMini, { backgroundColor: c.color }]}>
                      <View style={styles.cardMiniStripe} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text numberOfLines={1}>
                        <Text style={[styles.rowName, { color: theme.label }]}>{c.name}</Text>
                        {c.lastFour ? (
                          <Text style={[styles.rowLastFour, { color: theme.secondaryLabel }]}>{`  ·${c.lastFour}`}</Text>
                        ) : null}
                      </Text>
                      {/* negativeMuted for "due soon" — the theme's warning
                          shade, same as the old full-card layout used. */}
                      <Text
                        numberOfLines={1}
                        style={[styles.rowStatus, { color: dueSoon ? theme.negativeMuted : theme.tertiaryLabel }]}
                      >
                        {status}
                      </Text>
                    </View>
                    <AmountText amount={total} currency={settings.currency} size={16} weight="semibold" />
                    <Ionicons name="chevron-forward" size={16} color={theme.tertiaryLabel} />
                  </Pressable>
                </SwipeToDelete>
              </React.Fragment>
            );
          })}
        </Surface>
      </ScrollView>
      <AddCardModal visible={showAdd} onClose={() => setShowAdd(false)} onSave={addCard} usedCount={realCards.length} />
    </SafeAreaView>
  );
}

function AddCardModal({
  visible,
  onClose,
  onSave,
  usedCount,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { name: string; lastFour: string; color: string }) => Promise<void>;
  usedCount: number;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [lastFour, setLastFour] = useState('');

  const save = async () => {
    if (!name.trim() || !/^\d{4}$/.test(lastFour.trim())) {
      notify('Check the card details', 'Enter a card name and the last 4 digits (numbers only).');
      return;
    }
    await onSave({ name: name.trim(), lastFour: lastFour.trim(), color: CATEGORY_PALETTE[usedCount % CATEGORY_PALETTE.length] });
    setName('');
    setLastFour('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Scrolling sheet, not a plain View: on a short screen the keyboard
          otherwise sits over the Add Card button with no way to reach it. */}
      <KeyboardAwareScreen
        backgroundColor={theme.groupedBackground}
        contentContainerStyle={styles.modalContent}
      >
        <Text style={[type.title2, { color: theme.label, marginBottom: spacing.xl }]}>New Card</Text>
        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>CARD NAME</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="e.g. Chase Sapphire"
          placeholderTextColor={theme.tertiaryLabel}
          value={name}
          onChangeText={setName}
          maxLength={40}
        />
        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>LAST 4 DIGITS</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="1234"
          placeholderTextColor={theme.tertiaryLabel}
          keyboardType="number-pad"
          maxLength={4}
          value={lastFour}
          onChangeText={(text) => setLastFour(text.replace(/\D/g, ''))}
        />
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl }}>
          <Pressable style={[styles.button, { borderColor: theme.separator, borderWidth: 1 }]} onPress={onClose}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={save}>
            <Text style={{ color: theme.onAccent, fontWeight: '600' }}>Add Card</Text>
          </Pressable>
        </View>
      </KeyboardAwareScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  summaryText: { fontSize: 13 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthSwitcher: { marginTop: spacing.xs, marginHorizontal: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: 60 },
  list: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // Inset past the mini card (34) + row padding (lg) + gap (md), iOS-style, so
  // the line separates text from text instead of slicing the swatch column.
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg + 34 + spacing.md },
  // The same 8:5 miniature-with-chip-stripe language as the add-transaction
  // card chips (styles.cardMini there), a step larger for a primary row.
  cardMini: {
    width: 34,
    height: 22,
    borderRadius: 5,
    justifyContent: 'flex-end',
    paddingBottom: 4,
    paddingHorizontal: 5,
  },
  cardMiniStripe: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowLastFour: { fontSize: 14, fontWeight: '400', fontVariant: ['tabular-nums'] },
  rowStatus: { fontSize: 12 },
  empty: { alignItems: 'center', gap: spacing.md, marginTop: 60, paddingHorizontal: spacing.xxl },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // Scroll content, so no flex: 1 here — that would pin the sheet to the
  // viewport height and stop it scrolling the fields clear of the keyboard.
  modalContent: { padding: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  input: { padding: spacing.md, borderRadius: radius.sm, fontSize: 16 },
  button: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
});

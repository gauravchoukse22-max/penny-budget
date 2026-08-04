import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { CategoryIcon } from '../../components/CategoryIcon';
import { DatePickerField } from '../../components/DatePickerField';
import { confirmAction, notify } from '../../lib/confirm';
import { currencySymbol } from '../../lib/format';
import { parseMoneyInput } from '../../lib/parse-number';
import { getTransactionById, setTransactionSplits, listSplitsFor } from '../../lib/queries';
import { SplitEditor } from '../../components/SplitEditor';
import { Button } from '../../components/Button';
import { formatCurrency } from '../../lib/format';
import { validateSplits, type SplitPart } from '../../lib/transaction-splits';
import type { Transaction } from '../../lib/models';

// Matches the add-transaction screen so both screens' buttons are the same
// size; 52 clears Apple's 44pt minimum tap target.
const ACTION_HEIGHT = 52;

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, settings, editTransaction, removeTransaction, refresh } = useBudget();

  // The context only holds the SELECTED month. Search spans every month, so
  // opening one of its results used to hit "Transaction not found" for a row
  // that plainly existed and was listed a tap earlier. Fall back to reading it
  // straight from the database by id.
  const inSelectedMonth = transactions.find((t) => t.id === id) ?? null;
  const [fetched, setFetched] = useState<Transaction | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (inSelectedMonth || !id) return;
    let alive = true;
    setLookingUp(true);
    getTransactionById(id)
      .then((t) => {
        if (alive) setFetched(t);
      })
      .finally(() => {
        if (alive) setLookingUp(false);
      });
    return () => {
      alive = false;
    };
  }, [id, inSelectedMonth]);

  const transaction = inSelectedMonth ?? fetched;

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [isRefund, setIsRefund] = useState(false);
  // Splits are held here rather than read off `transaction` on every render:
  // the context's copy is only refreshed on a month reload, so a split saved
  // from this screen would not show until the user navigated away and back.
  const [splits, setSplits] = useState<SplitPart[]>([]);
  const [splitEditorOpen, setSplitEditorOpen] = useState(false);

  useEffect(() => {
    if (transaction) {
      setAmount(String(Math.abs(transaction.amount)));
      setIsRefund(transaction.amount < 0);
      setNote(transaction.note ?? '');
      setDate(transaction.date);
      setCategoryId(transaction.categoryId);
      setCardId(transaction.cardId);
      setSplits(transaction.splits ?? []);
    }
  }, [transaction?.id]);

  if (!transaction) {
    return (
      <View style={[styles.content, { backgroundColor: theme.groupedBackground }]}>
        <Text style={{ color: theme.tertiaryLabel }}>
          {lookingUp ? 'Loading…' : 'This transaction no longer exists — it may have been deleted.'}
        </Text>
      </View>
    );
  }

  const parsedAmount = parseMoneyInput(amount);
  const canSave = parsedAmount !== null && parsedAmount > 0 && !!cardId;

  const save = async () => {
    if (!canSave || !cardId || parsedAmount === null) return;
    const signedAmount = (isRefund ? -1 : 1) * parsedAmount;

    // Changing the amount on a split transaction breaks the parts: they were
    // written to sum to the OLD total, and saving anyway would leave the
    // difference attributed to nothing — money quietly missing from the
    // category totals with no error anywhere. Send the user back to the split
    // rather than guessing how they want the difference absorbed.
    if (splits.length > 0 && validateSplits(signedAmount, splits).length > 0) {
      notify(
        'Update the split first',
        `The parts add up to ${formatCurrency(
          splits.reduce((sum, p) => sum + p.amount, 0),
          settings.currency
        )}, not ${formatCurrency(signedAmount, settings.currency)}.`
      );
      setSplitEditorOpen(true);
      return;
    }

    await editTransaction(transaction.id, { amount: signedAmount, date, categoryId, cardId, note: note.trim() || null });
    router.back();
  };

  const confirmDelete = async () => {
    if (await confirmAction({ title: 'Delete transaction?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
      await removeTransaction(transaction.id);
      router.back();
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // The numeric pad has no Return key, so dragging is the only way out of it.
      keyboardDismissMode="on-drag"
      // Lets iOS inset by the real keyboard height. KeyboardAvoidingView was
      // guessing a 90pt header offset, which is wrong inside a modal
      // presentation and left the buttons under the keyboard.
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.amountRow}>
        <Text style={[styles.currencySymbol, { color: isRefund ? theme.systemGreen : theme.secondaryLabel }]}>
          {isRefund ? '+' : currencySymbol(settings.currency)}
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
      {splits.length > 0 ? (
        // A split transaction has no single category, so showing the picker
        // grid would offer a choice that does nothing — the parts decide where
        // the money lands. Show the parts instead, and the way back to editing
        // them.
        <View style={[styles.splitSummary, { backgroundColor: theme.card }]}>
          {splits.map((p, i) => {
            const category = categories.find((c) => c.id === p.categoryId);
            return (
              <View key={i} style={styles.splitSummaryRow}>
                {category ? (
                  <CategoryIcon icon={category.icon} color={category.color} size={18} />
                ) : (
                  <Ionicons name="help-circle-outline" size={18} color={theme.tertiaryLabel} />
                )}
                <Text style={{ color: theme.label, fontSize: 15, flex: 1 }} numberOfLines={1}>
                  {category?.name ?? 'No category'}
                </Text>
                <Text style={{ color: theme.secondaryLabel, fontSize: 15, fontWeight: '600' }}>
                  {formatCurrency(p.amount, settings.currency)}
                </Text>
              </View>
            );
          })}
          <Button
            label="Edit split"
            icon="git-branch-outline"
            variant="tonal"
            size="sm"
            onPress={() => setSplitEditorOpen(true)}
            style={{ alignSelf: 'flex-start' }}
          />
        </View>
      ) : (
        <>
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
          <Button
            label="Split across categories"
            icon="git-branch-outline"
            variant="glass"
            size="sm"
            onPress={() => setSplitEditorOpen(true)}
            style={{ alignSelf: 'flex-start', marginBottom: spacing.md }}
          />
        </>
      )}

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
      <DatePickerField value={date} onChange={setDate} />

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Note</Text>
      <TextInput
        style={[styles.noteInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
        value={note}
        onChangeText={setNote}
      />

      <View style={styles.actions}>
        <Pressable
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={[styles.actionButton, styles.actionPrimary, { backgroundColor: theme.accent }, !canSave && styles.actionDisabled]}
          onPress={save}
        >
          <Text style={[type.headline, { color: theme.onAccent }]}>Save Changes</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.actionButton, { borderColor: theme.systemRed }]}
          onPress={confirmDelete}
        >
          <Text style={[type.headline, { color: theme.systemRed }]}>Delete Transaction</Text>
        </Pressable>
      </View>

      <SplitEditor
        visible={splitEditorOpen}
        onClose={() => setSplitEditorOpen(false)}
        total={(isRefund ? -1 : 1) * (parsedAmount ?? Math.abs(transaction.amount))}
        currency={settings.currency}
        categories={categories}
        initialParts={splits}
        onSave={async (parts) => {
          await setTransactionSplits(transaction.id, parts);
          // Re-read rather than trusting the draft: setTransactionSplits
          // rewrites ids by index, and the screen should show what is actually
          // stored, not what was sent.
          setSplits(await listSplitsFor(transaction.id));
          // Splits move money between categories, and the context holds the
          // category summaries every other screen renders. Without this the
          // Budget Health bars keep showing the whole amount against the old
          // single category until the app is restarted — the split looks saved
          // here and ignored everywhere else.
          await refresh();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: 8, paddingBottom: 60 },
  splitSummary: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  splitSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  noteInput: { padding: 12, borderRadius: radius.sm, fontSize: 15 },
  actions: { gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border box — without it the outlined Delete
  // button sat 3pt taller than the filled Save button.
  actionButton: { height: ACTION_HEIGHT, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: 'transparent' },
  actionDisabled: { opacity: 0.4 },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { TagChips, TagPicker } from '../../components/TagPicker';
import { ReceiptField } from '../../components/ReceiptField';
import { RefundField } from '../../components/RefundBadge';
import { clearTagsForTransaction, listTagIdsForTransaction, listTags, setTransactionTags, type Tag } from '../../features/tags';
import { clearRefundClaim } from '../../features/refunds';
import { FundPaymentField } from '../../components/FundPaymentField';
import {
  clearTransactionFundPayment,
  getTransactionFundPayment,
  setTransactionFundPayment,
  type TransactionFundTarget,
} from '../../features/funds';
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
  // Tags are held as a draft and written on Save, like every other field here.
  // Writing them on each tap would leave a cancelled edit with the tags applied
  // anyway — the one part of the screen that ignored the Save button.
  const [tagIds, setTagIds] = useState<string[]>([]);
  // onClose can be invoked in the same tick as the last onChange, in which case
  // its closure still holds the PREVIOUS render's tagIds and would write a
  // selection one toggle out of date. The ref always holds what the user
  // actually chose.
  const tagIdsRef = useRef<string[]>([]);
  const applyTagIds = useCallback((ids: string[]) => {
    tagIdsRef.current = ids;
    setTagIds(ids);
  }, []);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  // Which fund this charge was paid out of, read back from the ledger — the
  // link lives on the fund entry, not on the transaction row, so there is
  // nothing on `transaction` to seed it from.
  const [fundTarget, setFundTarget] = useState<TransactionFundTarget>(null);

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

  // Two loaders, deliberately separate. The VOCABULARY (every tag that exists)
  // has to be re-read whenever the picker creates or deletes one; the
  // SELECTION must not be, because it is an unsaved draft — re-reading it on
  // picker close would silently throw away everything the user just picked and
  // put the stored tags back.
  const loadVocabulary = useCallback(async () => {
    setAllTags(await listTags());
  }, []);

  useEffect(() => {
    loadVocabulary();
  }, [loadVocabulary]);

  useEffect(() => {
    if (!transaction?.id) return;
    let alive = true;
    listTagIdsForTransaction(transaction.id).then((ids) => {
      if (alive) applyTagIds(ids);
    });
    return () => {
      alive = false;
    };
  }, [transaction?.id]);

  useEffect(() => {
    if (!transaction?.id) return;
    let alive = true;
    getTransactionFundPayment(transaction.id).then((entry) => {
      if (alive && entry) setFundTarget({ fundId: entry.fundId, accountId: entry.accountId });
    });
    return () => {
      alive = false;
    };
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

  // Resolved against the vocabulary rather than stored on the draft: a tag
  // deleted from the picker disappears from here immediately instead of
  // lingering as a chip with no row behind it.
  const selectedTags = tagIds.flatMap((id) => allTags.find((t) => t.id === id) ?? []);

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
    // After the transaction write, so a failure there does not leave the tags
    // pointing at a row that was never updated.
    await setTransactionTags(transaction.id, tagIdsRef.current);
    // Called unconditionally, including when no fund is selected: this is what
    // UNLINKS a charge that used to come out of one, and it re-files the
    // withdrawal at the edited amount and date. Correcting a $500 booking to
    // $450 has to move the fund by the same $50, or the two disagree with
    // nothing on screen to say so.
    await setTransactionFundPayment(
      { transactionId: transaction.id, amount: signedAmount, date, note: note.trim() || null },
      fundTarget
    );
    router.back();
  };

  const confirmDelete = async () => {
    if (await confirmAction({ title: 'Delete transaction?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
      // Swept BEFORE the transaction goes, while the join rows and the claim are
      // still readable and can be journaled individually. Foreign keys are not
      // enforced here so nothing cascades, and lib/queries.ts deleteTransaction
      // knows nothing about either table — an orphaned join row would keep
      // counting toward its tag's total, and an orphaned claim would sit in the
      // outstanding total with no transaction left to open. features/tags.ts and
      // features/refunds.ts each carry a sweep for the delete paths that cannot
      // reach this line (bulk delete, and a tombstone arriving from the other
      // phone), but doing it here keeps the common case immediate rather than
      // waiting for the next read to notice.
      await clearTagsForTransaction(transaction.id);
      await clearRefundClaim(transaction.id);
      // Same sweep-before-delete rule. Deleting the charge has to give the
      // money back to the fund — leaving the withdrawal behind would keep the
      // fund permanently low, with a line in its history pointing at a purchase
      // that no longer exists. features/funds.ts carries a backstop for the
      // paths that cannot reach this line, but this is the common case.
      await clearTransactionFundPayment(transaction.id);
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

      {/* Tags sit below the category picker, not beside it, because they answer
          a different question — the category is what KIND of spending this is,
          the tag is what it was FOR. Putting them side by side invites the user
          to treat them as alternatives. */}
      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Tags</Text>
      <View style={styles.tagRow}>
        {selectedTags.length > 0 ? (
          <TagChips tags={selectedTags} style={styles.tagChips} />
        ) : (
          <Text style={{ color: theme.tertiaryLabel, fontSize: 13, flex: 1 }}>
            None — tag this to group it across categories
          </Text>
        )}
        <Button
          label={selectedTags.length > 0 ? 'Edit' : 'Add'}
          icon="pricetags-outline"
          variant="glass"
          size="sm"
          onPress={() => setTagPickerOpen(true)}
        />
      </View>

      {/* Unlike the fields around it this one is a DRAFT, written on Save
          Changes — the withdrawal has to move with the amount and the date, and
          writing it on each tap would leave a cancelled edit having already
          moved money out of the fund. */}
      <FundPaymentField
        value={fundTarget}
        onChange={setFundTarget}
        amount={(isRefund ? -1 : 1) * (parsedAmount ?? Math.abs(transaction.amount))}
        currency={settings.currency}
        transactionId={transaction.id}
      />

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Refund</Text>
      {/* Writes immediately rather than on Save, unlike the fields above. A
          claim is its own record with its own id, not a property of this form,
          and the outstanding total it feeds should not depend on the user
          remembering to press Save on a screen they opened to check something
          else. */}
      <RefundField
        transactionId={transaction.id}
        transactionAmount={transaction.amount}
        currency={settings.currency}
        onChanged={refresh}
      />

      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Receipt</Text>
      {/* Only on this screen, never on Add: attaching copies a file onto disk
          keyed by the transaction id, and on the add screen there is no id yet.
          Writing the file first and inventing an id would leave an orphaned
          image behind every time someone backs out of adding a transaction. */}
      <ReceiptField transactionId={transaction.id} onChanged={refresh} />

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

      <TagPicker
        visible={tagPickerOpen}
        onClose={async () => {
          setTagPickerOpen(false);
          // Only the vocabulary — the picker can create and delete tags, so the
          // list of what EXISTS is stale by the time it closes. The selection is
          // not re-read; it is the draft the user just made.
          await loadVocabulary();
          // Persist the selection NOW rather than leaving it to Save Changes.
          //
          // The split editor on this same screen writes immediately, so leaving
          // tags as form state gave one screen two rules: a split survived
          // backing out and a tag silently did not. The chips render the moment
          // the picker closes, which makes the loss invisible until the user
          // comes back and finds them gone. The transaction already exists here
          // (unlike the add screen, which has no id until it saves), so there is
          // nothing to wait for.
          //
          // save() still calls this — it is idempotent, and the tags must land
          // after the transaction write there rather than before it.
          await setTransactionTags(transaction.id, tagIdsRef.current);
        }}
        selectedTagIds={tagIds}
        onChange={applyTagIds}
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
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tagChips: { flex: 1 },
  actions: { gap: spacing.md, marginTop: spacing.xl },
  // Both buttons carry the same border box — without it the outlined Delete
  // button sat 3pt taller than the filled Save button.
  actionButton: { height: ACTION_HEIGHT, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionPrimary: { borderColor: 'transparent' },
  actionDisabled: { opacity: 0.4 },
});

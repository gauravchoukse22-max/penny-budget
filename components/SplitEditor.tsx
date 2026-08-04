import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, IconButton } from './Button';
import { CategoryIcon } from './CategoryIcon';
import { PressableScale } from './PressableScale';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { formatCurrency, currencySymbol } from '../lib/format';
import { parseMoneyExpression } from '../lib/parse-number';
import { equalParts, remainderFor, validateSplits, type SplitError, type SplitPart } from '../lib/transaction-splits';
import type { Category } from '../lib/models';

// Editing one transaction's split across categories.
//
// The arithmetic all lives in lib/transaction-splits.ts (pure, fixture-tested);
// this file is only the surface. The rule it enforces is that parts must sum to
// the transaction total EXACTLY — Save stays disabled until they do, because a
// split that is a cent off moves a cent out of the category totals, which is
// the exact bug splits exist to stop.
//
// Two affordances exist purely so the user never has to do the arithmetic
// themselves, which is where the off-by-a-cent errors come from: "Split evenly"
// (largest-remainder, so 10/3 still sums) and the per-row "fill rest" arrow.

export function SplitEditor({
  visible,
  onClose,
  onSave,
  total,
  currency,
  categories,
  initialParts,
}: {
  visible: boolean;
  onClose: () => void;
  /** Empty array means "this is no longer a split" — the caller should clear it. */
  onSave: (parts: SplitPart[]) => Promise<void> | void;
  total: number;
  currency: string;
  categories: Category[];
  initialParts: SplitPart[];
}) {
  const theme = useTheme();
  // Drafts are strings, not numbers: a half-typed "12." parses to nothing and
  // storing numbers would fight the user's cursor on every keystroke.
  const [drafts, setDrafts] = useState<{ categoryId: string | null; text: string }[]>([]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Opening on a transaction with no split seeds two rows — one split is not
    // a split, and starting from an empty list makes the first action "add a
    // row" rather than "say how it divides".
    const seed =
      initialParts.length > 0
        ? initialParts.map((p) => ({ categoryId: p.categoryId, text: String(p.amount) }))
        : equalParts(total, 2).map((a) => ({ categoryId: null, text: String(a) }));
    setDrafts(seed);
  }, [visible, initialParts, total]);

  const parts: SplitPart[] = useMemo(
    () => drafts.map((d) => ({ categoryId: d.categoryId, amount: parseMoneyExpression(d.text) ?? 0 })),
    [drafts]
  );
  const errors = useMemo(() => validateSplits(total, parts), [total, parts]);
  const mismatch = errors.find((e): e is Extract<SplitError, { kind: 'sum-mismatch' }> => e.kind === 'sum-mismatch');
  const canSave = errors.length === 0;

  const money = (n: number) => formatCurrency(n, currency);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const setText = (index: number, text: string) =>
    setDrafts((d) => d.map((row, i) => (i === index ? { ...row, text } : row)));
  const setCategory = (index: number, categoryId: string | null) =>
    setDrafts((d) => d.map((row, i) => (i === index ? { ...row, categoryId } : row)));
  const addRow = () => setDrafts((d) => [...d, { categoryId: null, text: '0' }]);
  const removeRow = (index: number) => setDrafts((d) => d.filter((_, i) => i !== index));
  const fillRest = (index: number) => setText(index, String(remainderFor(total, parts, index)));
  const splitEvenly = () =>
    setDrafts((d) => equalParts(total, d.length).map((a, i) => ({ ...d[i], text: String(a) })));

  const commit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(parts);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const unsplit = async () => {
    setSaving(true);
    try {
      await onSave([]);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <Button label="Cancel" variant="ghost" size="sm" onPress={onClose} />
          <Text style={[type.headline, { color: theme.label }]}>Split</Text>
          <Button label="Save" variant="ghost" size="sm" disabled={!canSave} loading={saving} onPress={commit} />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* The running total is the whole point of the screen, so it sits at
              the top and states the gap in money rather than saying "invalid". */}
          <View style={[styles.summary, { backgroundColor: theme.card }]}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 13 }}>Transaction total</Text>
            <Text style={{ color: theme.label, fontSize: 28, fontWeight: '700' }}>{money(total)}</Text>
            {mismatch ? (
              <Text style={{ color: theme.systemRed, fontSize: 14, fontWeight: '600' }}>
                {mismatch.difference > 0
                  ? `${money(mismatch.difference)} still to assign`
                  : `${money(-mismatch.difference)} over the total`}
              </Text>
            ) : (
              <Text style={{ color: theme.systemGreen, fontSize: 14, fontWeight: '600' }}>Every cent assigned</Text>
            )}
          </View>

          {drafts.map((row, index) => {
            const category = row.categoryId ? categoryById.get(row.categoryId) : null;
            return (
              <View key={index} style={[styles.row, { backgroundColor: theme.card }]}>
                <PressableScale
                  haptic
                  onPress={() => setPickerFor(index)}
                  accessibilityRole="button"
                  accessibilityLabel={category ? `Category: ${category.name}` : 'Choose a category'}
                  style={styles.rowCategory}
                  contentStyle={styles.rowCategoryContent}
                >
                  {category ? (
                    <CategoryIcon icon={category.icon} color={category.color} size={20} />
                  ) : (
                    <Ionicons name="help-circle-outline" size={20} color={theme.tertiaryLabel} />
                  )}
                  <Text
                    numberOfLines={1}
                    style={{ color: category ? theme.label : theme.tertiaryLabel, fontSize: 15, flex: 1 }}
                  >
                    {category?.name ?? 'Choose category'}
                  </Text>
                </PressableScale>

                <View style={styles.rowAmount}>
                  <Text style={{ color: theme.secondaryLabel, fontSize: 15 }}>{currencySymbol(currency)}</Text>
                  <TextInput
                    value={row.text}
                    onChangeText={(t) => setText(index, t)}
                    keyboardType="numbers-and-punctuation"
                    selectTextOnFocus
                    placeholder="0"
                    placeholderTextColor={theme.tertiaryLabel}
                    style={[styles.input, { color: theme.label }]}
                    accessibilityLabel={`Amount for part ${index + 1}`}
                  />
                </View>

                <IconButton
                  icon="arrow-down-circle-outline"
                  size="sm"
                  accessibilityLabel={`Put the remaining amount on part ${index + 1}`}
                  onPress={() => fillRest(index)}
                />
                <IconButton
                  icon="close"
                  size="sm"
                  variant="destructive"
                  accessibilityLabel={`Remove part ${index + 1}`}
                  disabled={drafts.length <= 2}
                  onPress={() => removeRow(index)}
                />
              </View>
            );
          })}

          <View style={styles.actions}>
            <Button label="Add part" icon="add" variant="tonal" size="sm" onPress={addRow} />
            <Button label="Split evenly" icon="git-branch-outline" variant="glass" size="sm" onPress={splitEvenly} />
          </View>

          {/* Duplicate and sign problems get their own line: the money summary
              above cannot express them, and "Save is disabled" with no reason
              is the thing that makes an editor feel broken. */}
          {errors.some((e) => e.kind === 'duplicate-category') ? (
            <Text style={{ color: theme.systemRed, fontSize: 13 }}>
              Two parts use the same category — combine them into one.
            </Text>
          ) : null}
          {errors.some((e) => e.kind === 'wrong-sign') ? (
            <Text style={{ color: theme.systemRed, fontSize: 13 }}>
              One part points the opposite way to the transaction. Check for a stray minus sign.
            </Text>
          ) : null}

          {initialParts.length > 0 ? (
            <Button
              label="Remove split"
              variant="destructive"
              onPress={unsplit}
              full
              style={{ marginTop: spacing.lg }}
            />
          ) : null}

          <Text style={{ color: theme.tertiaryLabel, fontSize: 12, textAlign: 'center' }}>
            Each part counts toward its own category's budget. The transaction still shows once on
            your card for {money(total)}.
          </Text>
        </ScrollView>

        {/* Category picker, reusing the same list shape as the rest of the app. */}
        <Modal
          visible={pickerFor !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setPickerFor(null)}
        >
          <View style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
            <View style={[styles.header, { borderBottomColor: theme.separator }]}>
              <View style={{ width: 60 }} />
              <Text style={[type.headline, { color: theme.label }]}>Category</Text>
              <Button label="Done" variant="ghost" size="sm" onPress={() => setPickerFor(null)} />
            </View>
            <ScrollView contentContainerStyle={styles.body}>
              <PressableScale
                haptic
                onPress={() => {
                  if (pickerFor !== null) setCategory(pickerFor, null);
                  setPickerFor(null);
                }}
                style={[styles.pickerRow, { backgroundColor: theme.card }]}
                contentStyle={styles.pickerRowContent}
              >
                <Ionicons name="help-circle-outline" size={22} color={theme.tertiaryLabel} />
                <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>No category (review later)</Text>
              </PressableScale>
              {categories.map((c) => (
                <PressableScale
                  key={c.id}
                  haptic
                  onPress={() => {
                    if (pickerFor !== null) setCategory(pickerFor, c.id);
                    setPickerFor(null);
                  }}
                  style={[styles.pickerRow, { backgroundColor: theme.card }]}
                  contentStyle={styles.pickerRowContent}
                >
                  <CategoryIcon icon={c.icon} color={c.color} size={22} />
                  <Text style={{ color: theme.label, fontSize: 16 }}>{c.name}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  summary: { borderRadius: radius.lg, padding: spacing.lg, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  rowCategory: { flex: 1, minHeight: 44, justifyContent: 'center' },
  rowCategoryContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '100%' },
  rowAmount: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 96 },
  input: { fontSize: 17, fontWeight: '600', minWidth: 72, padding: 0 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  pickerRow: { borderRadius: radius.md, paddingHorizontal: spacing.lg, minHeight: 52, justifyContent: 'center' },
  pickerRowContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, width: '100%' },
});

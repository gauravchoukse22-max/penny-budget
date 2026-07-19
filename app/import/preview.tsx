import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Modal } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { formatCurrency } from '../../lib/format';
import { takePendingImport } from '../../features/import-preview-store';
import { commitStatementRows, type StatementPreviewRow } from '../../features/statement-import';
import { confirmAction, notify } from '../../lib/confirm';

// Review-before-write screen for statement import. The parser hands over its
// best interpretation; this screen makes every decision visible and reversible
// BEFORE anything touches the database:
//   * each row can be toggled off (duplicates and recurring bills start off),
//   * its category can be reassigned,
//   * the amount sign can be flipped if the parser guessed the convention wrong,
//   * rows the parser couldn't read are shown, not silently dropped.
// This is what lets the import be trusted on statement layouts we've never seen.

type Row = StatementPreviewRow & { include: boolean; id: number };

export default function ImportPreviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, settings, refresh } = useBudget();

  // Read the hand-off exactly once. If it's missing (deep-linked here directly,
  // or committed already), there's nothing to show.
  const [pending] = useState(() => takePendingImport());
  const [rows, setRows] = useState<Row[]>(() =>
    (pending?.preview.rows ?? []).map((r, i) => ({
      ...r,
      id: i,
      include: !r.duplicate && !r.recurring,
    }))
  );
  const [committing, setCommitting] = useState(false);
  const [categoryPickerFor, setCategoryPickerFor] = useState<number | null>(null);

  const currency = settings.currency;
  const card = cards.find((c) => c.id === pending?.cardId) ?? null;
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;

  const includedCount = rows.filter((r) => r.include).length;

  const summary = useMemo(() => {
    const included = rows.filter((r) => r.include);
    const spend = included.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const credit = included.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    return { spend, credit };
  }, [rows]);

  if (!pending) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Import' }} />
        <View style={styles.emptyWrap}>
          <Text style={[type.body, { color: theme.secondaryLabel, textAlign: 'center' }]}>
            This import has expired. Start it again from Settings → Import Credit Card Statement.
          </Text>
          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={() => router.back()}>
            <Text style={[type.headline, { color: theme.onAccent }]}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { preview } = pending;

  const toggle = (id: number) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, include: !r.include } : r)));
  const flipSign = (id: number) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amount: -r.amount } : r)));
  const setCategory = (id: number, categoryId: string | null) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, categoryId } : r)));
  const setAll = (include: boolean) => setRows((rs) => rs.map((r) => ({ ...r, include })));

  const commit = async () => {
    const toImport = rows.filter((r) => r.include);
    if (toImport.length === 0) {
      notify('Nothing selected', 'Turn on at least one transaction to import.');
      return;
    }
    setCommitting(true);
    try {
      const result = await commitStatementRows(pending.cardId, toImport);
      await refresh();
      const extra = result.uncategorized > 0 ? `\n${result.uncategorized} still need a category — find them under Uncategorized.` : '';
      if (await confirmAction({ title: 'Import complete', message: `Added ${result.imported} transaction(s) to ${card?.name ?? 'your card'}.${extra}`, confirmLabel: 'Done' })) {
        router.back();
      }
    } catch (e) {
      notify('Import failed', 'Something went wrong while saving. No partial data was left behind that you can\'t edit.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.groupedBackground }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Review Import' }} />
      <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic">
        {/* What the parser decided, stated plainly so a wrong guess is catchable. */}
        <View style={[styles.banner, { backgroundColor: theme.accentTint }]}>
          <Text style={[type.subhead, { color: theme.label }]}>
            {preview.rows.length} transaction(s) found in {preview.filename}
          </Text>
          <Text style={[styles.bannerNote, { color: theme.secondaryLabel }]}>
            {preview.signFlipped
              ? 'Amounts were flipped so purchases show as spending. '
              : 'Purchases are read as spending. '}
            {preview.inferredYear != null
              ? `Dates without a year were set to ${preview.inferredYear}. `
              : ''}
            Check anything that looks off, then import.
          </Text>
          {card && (
            <Text style={[styles.bannerNote, { color: theme.secondaryLabel, marginTop: 2 }]}>
              Importing to: <Text style={{ color: theme.label, fontWeight: '600' }}>{card.name}</Text>
            </Text>
          )}
        </View>

        {/* Running total of what's selected. */}
        <View style={[styles.summaryRow, { borderColor: theme.separator }]}>
          <View>
            <Text style={[styles.summaryLabel, { color: theme.tertiaryLabel }]}>SPENDING</Text>
            <Text style={[type.headline, { color: theme.label }]}>{formatCurrency(summary.spend, currency)}</Text>
          </View>
          {summary.credit < 0 && (
            <View>
              <Text style={[styles.summaryLabel, { color: theme.tertiaryLabel }]}>CREDITS</Text>
              <Text style={[type.headline, { color: theme.systemGreen }]}>{formatCurrency(summary.credit, currency)}</Text>
            </View>
          )}
          <View>
            <Text style={[styles.summaryLabel, { color: theme.tertiaryLabel }]}>SELECTED</Text>
            <Text style={[type.headline, { color: theme.label }]}>{includedCount} / {rows.length}</Text>
          </View>
        </View>

        <View style={styles.selectAllRow}>
          <Pressable onPress={() => setAll(true)} hitSlop={8}>
            <Text style={[type.subhead, { color: theme.accent }]}>Select all</Text>
          </Pressable>
          <Text style={{ color: theme.separator }}>│</Text>
          <Pressable onPress={() => setAll(false)} hitSlop={8}>
            <Text style={[type.subhead, { color: theme.accent }]}>Deselect all</Text>
          </Pressable>
        </View>

        {/* The rows. */}
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          {rows.map((row, idx) => (
            <View
              key={row.id}
              style={[
                styles.row,
                idx < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
                !row.include && styles.rowExcluded,
              ]}
            >
              <Pressable onPress={() => toggle(row.id)} hitSlop={6} style={styles.checkbox}>
                <Ionicons
                  name={row.include ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={row.include ? theme.accent : theme.tertiaryLabel}
                />
              </Pressable>

              <View style={styles.rowBody}>
                <Text style={[type.body, { color: theme.label }]} numberOfLines={1}>
                  {row.note}
                </Text>
                <View style={styles.rowMeta}>
                  <Text style={[styles.metaText, { color: theme.secondaryLabel }]}>{row.date}</Text>
                  <Pressable onPress={() => setCategoryPickerFor(row.id)} hitSlop={6} style={styles.categoryChip}>
                    <Text style={[styles.metaText, { color: categoryName(row.categoryId) ? theme.accent : theme.tertiaryLabel }]}>
                      {categoryName(row.categoryId) ?? 'Set category'}
                    </Text>
                  </Pressable>
                  {row.duplicate && (
                    <Text style={[styles.tag, { color: theme.systemAmber }]}>Already imported</Text>
                  )}
                  {row.recurring && (
                    <Text style={[styles.tag, { color: theme.systemAmber }]}>Recurring bill</Text>
                  )}
                </View>
              </View>

              <Pressable onPress={() => flipSign(row.id)} hitSlop={6} style={styles.amountBtn}>
                <Text
                  style={[
                    type.headline,
                    { color: row.amount < 0 ? theme.systemGreen : theme.label },
                  ]}
                >
                  {formatCurrency(row.amount, currency)}
                </Text>
                <Text style={[styles.flipHint, { color: theme.tertiaryLabel }]}>tap ±</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* Rows the parser couldn't read — surfaced, never hidden. */}
        {preview.skipped.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.card, marginTop: spacing.lg }]}>
            <Text style={[styles.skippedHeader, { color: theme.secondaryLabel }]}>
              {preview.skipped.length} line(s) skipped
            </Text>
            {preview.skipped.slice(0, 20).map((s, i) => (
              <View key={i} style={styles.skippedRow}>
                <Text style={[styles.metaText, { color: theme.tertiaryLabel }]} numberOfLines={1}>
                  {reasonLabel(s.reason)} · {s.raw}
                </Text>
              </View>
            ))}
            {preview.skipped.length > 20 && (
              <Text style={[styles.metaText, { color: theme.tertiaryLabel, padding: spacing.md }]}>
                …and {preview.skipped.length - 20} more.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Commit bar. */}
      <View style={[styles.footer, { backgroundColor: theme.card, borderTopColor: theme.separator }]}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: includedCount > 0 ? theme.accent : theme.separator }]}
          onPress={commit}
          disabled={committing || includedCount === 0}
        >
          {committing ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={[type.headline, { color: theme.onAccent }]}>
              Import {includedCount} transaction{includedCount === 1 ? '' : 's'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Category picker. */}
      <Modal visible={categoryPickerFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCategoryPickerFor(null)}>
        <SafeAreaView style={[styles.flex, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.pickerHeader}>
            <Text style={[type.title2, { color: theme.label }]}>Category</Text>
            <Pressable onPress={() => setCategoryPickerFor(null)} hitSlop={8}>
              <Text style={[type.headline, { color: theme.accent }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView>
            <Pressable
              style={[styles.pickerRow, { borderBottomColor: theme.separator }]}
              onPress={() => {
                if (categoryPickerFor !== null) setCategory(categoryPickerFor, null);
                setCategoryPickerFor(null);
              }}
            >
              <Text style={[type.body, { color: theme.secondaryLabel }]}>No category (review later)</Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.pickerRow, { borderBottomColor: theme.separator }]}
                onPress={() => {
                  if (categoryPickerFor !== null) setCategory(categoryPickerFor, c.id);
                  setCategoryPickerFor(null);
                }}
              >
                <View style={[styles.catDot, { backgroundColor: c.color }]} />
                <Text style={[type.body, { color: theme.label }]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'no-date': return 'No date';
    case 'no-amount': return 'No amount';
    case 'zero-amount': return 'Zero amount';
    case 'section-total': return 'Section total';
    default: return 'Skipped';
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.lg },
  banner: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg },
  bannerNote: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  summaryLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  selectAllRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowExcluded: { opacity: 0.4 },
  checkbox: { width: 30 },
  rowBody: { flex: 1, minWidth: 0 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3, flexWrap: 'wrap' },
  metaText: { fontSize: 13 },
  categoryChip: {},
  tag: { fontSize: 12, fontWeight: '600' },
  amountBtn: { alignItems: 'flex-end', minWidth: 84 },
  flipHint: { fontSize: 10, marginTop: 1 },
  skippedHeader: { fontSize: 13, fontWeight: '600', padding: spacing.md, paddingBottom: spacing.sm },
  skippedRow: { paddingHorizontal: spacing.md, paddingVertical: 4 },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  primaryBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  catDot: { width: 14, height: 14, borderRadius: 7 },
});

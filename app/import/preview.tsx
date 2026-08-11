import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SheetModal } from '../../components/SheetModal';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Button, IconButton } from '../../components/Button';
import { formatCurrency, formatMonthLabel } from '../../lib/format';
import { takePendingImport } from '../../features/import-preview-store';
import { commitStatementRows, learnFromReviewedRows, type StatementPreviewRow } from '../../features/statement-import';
import { confirmAction, notify } from '../../lib/confirm';
import { useAndroidBackGuard } from '../../lib/useAndroidBackGuard';

// Review-before-write screen for statement import. The parser hands over its
// best interpretation; this screen makes every decision visible and reversible
// BEFORE anything touches the database:
//   * each row can be toggled off (duplicates and recurring bills start off),
//   * its category can be reassigned, one row at a time or in bulk,
//   * a category the app GUESSED is drawn differently from one that is settled,
//     and has to be accepted before it counts as reviewed,
//   * the amount sign can be flipped if the parser guessed the convention wrong,
//   * rows the parser couldn't read are shown, not silently dropped.
// This is what lets the import be trusted on statement layouts we've never seen.
//
// Two independent per-row states live here and they are deliberately NOT the
// same thing:
//   `include`  — will this row be written to the budget? (the circle on the left)
//   `selected` — is this row part of the current bulk edit? (select mode only)
// An earlier attempt reused `include` as the bulk-edit target, which meant
// bulk-categorising a handful of rows required deselecting everything first —
// and re-selecting all afterwards silently switched the duplicates back on.

type Row = StatementPreviewRow & { include: boolean; id: number };

/** Which row the category picker is editing — or the whole bulk selection. */
type PickerTarget = number | 'bulk' | null;

export default function ImportPreviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, settings, refresh, selectedMonth, setSelectedMonth } = useBudget();
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
  const [categoryPickerFor, setCategoryPickerFor] = useState<PickerTarget>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Leaving loses the parsed rows (they're handed over exactly once), so it is
  // confirmed rather than free — but it is always POSSIBLE. This screen is
  // presented as a modal, which gives it no back button, and it blocks
  // Android's back button; with no Cancel of its own, the only way off it was
  // to import transactions the user had already decided against. Android back
  // now runs this same confirm.
  const cancelImport = async () => {
    if (committing) return;
    const ok = await confirmAction({
      title: 'Discard this import?',
      message: 'Nothing has been added to your budget. You can pick the file again whenever you want.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep reviewing',
      destructive: true,
    });
    if (ok) router.back();
  };
  useAndroidBackGuard(true, () => void cancelImport());

  const currency = settings.currency;
  const card = cards.find((c) => c.id === pending?.cardId) ?? null;
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;

  const includedCount = rows.filter((r) => r.include).length;
  const suggestedCount = rows.filter((r) => r.suggested && r.categoryId).length;

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
          <Button label="Go back" variant="primary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const { preview } = pending;

  const toggle = (id: number) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, include: !r.include } : r)));
  const flipSign = (id: number) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amount: -r.amount } : r)));
  const setAll = (include: boolean) => setRows((rs) => rs.map((r) => ({ ...r, include })));

  // Choosing a category is a decision, so it always lands as 'user' and stops
  // being a suggestion — that is exactly what makes it worth learning from.
  const setCategory = (id: number, categoryId: string | null) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === id ? { ...r, categoryId, categoryOrigin: categoryId ? 'user' : null, suggested: false } : r
      )
    );

  const setCategoryForSelection = (categoryId: string | null) =>
    setRows((rs) =>
      rs.map((r) =>
        selected.has(r.id)
          ? { ...r, categoryId, categoryOrigin: categoryId ? 'user' : null, suggested: false }
          : r
      )
    );

  /** Accepting a guess keeps its origin — the row was categorised by history or
   *  the classifier, and the user agreed. Only `suggested` changes. */
  const acceptSuggestion = (id: number) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, suggested: false } : r)));

  const confirmAllSuggestions = () =>
    setRows((rs) => rs.map((r) => (r.suggested && r.categoryId ? { ...r, suggested: false } : r)));

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const allSelected = selected.size === rows.length && rows.length > 0;

  const applyPickedCategory = (categoryId: string | null) => {
    if (categoryPickerFor === 'bulk') {
      setCategoryForSelection(categoryId);
      exitSelectMode();
    } else if (categoryPickerFor !== null) {
      setCategory(categoryPickerFor, categoryId);
    }
    setCategoryPickerFor(null);
  };

  const commit = async () => {
    const toImport = rows.filter((r) => r.include);
    if (toImport.length === 0) {
      notify('Nothing selected', 'Turn on at least one transaction to import.');
      return;
    }
    setCommitting(true);
    try {
      const result = await commitStatementRows(pending.cardId, toImport);
      // Every reviewed row, not just the imported ones: a duplicate the user
      // re-categorised and then switched off is still a correction worth
      // keeping for next month.
      const learned = await learnFromReviewedRows(rows);

      // A statement is history: its rows are almost never dated in the month
      // the app is currently showing. Every screen filters to `selectedMonth`,
      // so importing a June statement in August adds the rows and shows an
      // unchanged, empty August — indistinguishable from the import having
      // failed. Move to the month the rows actually landed in, and SAY so.
      const months = [...new Set(toImport.map((r) => r.date.slice(0, 7)))].sort();
      const target = months[months.length - 1] ?? selectedMonth;
      if (target !== selectedMonth) setSelectedMonth(target);
      await refresh();

      const span =
        months.length > 1
          ? `\n\nThey're dated ${formatMonthLabel(months[0])} – ${formatMonthLabel(months[months.length - 1])}. Showing ${formatMonthLabel(target)} — use the month arrows at the top to see the rest.`
          : months.length === 1 && target !== selectedMonth
            ? `\n\nThey're dated ${formatMonthLabel(target)}, so that's the month you're now looking at.`
            : '';
      const extra = result.uncategorized > 0 ? `\n${result.uncategorized} still need a category — find them under Uncategorized.` : '';
      // Say what was learned. Silent learning that changes how the NEXT import
      // behaves is the kind of thing that looks like a bug when the user
      // notices it months later.
      const taught =
        learned > 0
          ? `\nKaiJar remembered ${learned} merchant${learned === 1 ? '' : 's'} — next time they'll be categorised for you.`
          : '';
      if (await confirmAction({ title: 'Import complete', message: `Added ${result.imported} transaction(s) to ${card?.name ?? 'your card'}.${extra}${taught}${span}`, confirmLabel: 'Done' })) {
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
      <Stack.Screen
        options={{
          title: 'Review Import',
          // A modal has no back button of its own. Without this the only way
          // off the screen was to import.
          headerLeft: () => (
            <Pressable onPress={cancelImport} disabled={committing} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel import">
              <Text style={[type.body, { color: committing ? theme.tertiaryLabel : theme.accent }]}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
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
            <Text style={[styles.summaryLabel, { color: theme.tertiaryLabel }]}>INCLUDED</Text>
            <Text style={[type.headline, { color: theme.label }]}>{includedCount} / {rows.length}</Text>
          </View>
        </View>

        {/* Toolbar. In select mode the row circles stop meaning "include" and
            start meaning "part of this bulk edit", so the whole bar swaps
            rather than showing both sets of controls at once. */}
        {selecting ? (
          <View style={styles.toolbar}>
            <Button
              label={allSelected ? 'Select none' : 'Select all'}
              variant="ghost"
              size="sm"
              onPress={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            />
            <View style={styles.toolbarSpacer} />
            <Button
              label={`Set category (${selected.size})`}
              variant="tonal"
              size="sm"
              icon="pricetag-outline"
              disabled={selected.size === 0}
              onPress={() => setCategoryPickerFor('bulk')}
            />
            <Button label="Done" variant="ghost" size="sm" onPress={exitSelectMode} />
          </View>
        ) : (
          <>
            <View style={styles.toolbar}>
              <Button label="Include all" variant="ghost" size="sm" onPress={() => setAll(true)} />
              <Button label="Include none" variant="ghost" size="sm" onPress={() => setAll(false)} />
              <View style={styles.toolbarSpacer} />
              <Button
                label="Bulk edit"
                variant="glass"
                size="sm"
                icon="pricetags-outline"
                onPress={() => setSelecting(true)}
                accessibilityLabel="Select several transactions and set one category on all of them"
              />
            </View>

            {/* Suggestions, and what accepting them buys the user. Confirming
                is what writes the keyword rule, so it is worth saying out loud
                rather than leaving as an invisible side effect. */}
            {suggestedCount > 0 && (
              <View style={[styles.suggestBar, { backgroundColor: theme.card }]}>
                <Ionicons name="sparkles" size={15} color={theme.systemAmber} />
                <Text style={[styles.suggestText, { color: theme.secondaryLabel }]}>
                  {suggestedCount} categor{suggestedCount === 1 ? 'y was' : 'ies were'} guessed. Confirming teaches
                  KaiJar to get {suggestedCount === 1 ? 'it' : 'them'} right automatically next time.
                </Text>
                <Button
                  label={`Confirm ${suggestedCount}`}
                  variant="tonal"
                  size="sm"
                  onPress={confirmAllSuggestions}
                  accessibilityLabel={`Confirm all ${suggestedCount} suggested categories`}
                />
              </View>
            )}
          </>
        )}

        {/* The rows. */}
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          {rows.map((row, idx) => {
            const isSelected = selected.has(row.id);
            const name = categoryName(row.categoryId);
            return (
              <View
                key={row.id}
                style={[
                  styles.row,
                  idx < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
                  !selecting && !row.include && styles.rowExcluded,
                  selecting && isSelected && { backgroundColor: theme.accentTint },
                ]}
              >
                <Pressable
                  onPress={() => (selecting ? toggleSelect(row.id) : toggle(row.id))}
                  hitSlop={6}
                  style={styles.checkbox}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selecting ? isSelected : row.include }}
                  accessibilityLabel={selecting ? `Select ${row.note}` : `Import ${row.note}`}
                >
                  <Ionicons
                    name={
                      selecting
                        ? isSelected
                          ? 'checkbox'
                          : 'square-outline'
                        : row.include
                          ? 'checkmark-circle'
                          : 'ellipse-outline'
                    }
                    size={26}
                    color={(selecting ? isSelected : row.include) ? theme.accent : theme.tertiaryLabel}
                  />
                </Pressable>

                {/* In select mode the body is one big selection target: the
                    category chip and the ± button would otherwise be tiny
                    dead zones inside a row the user is trying to tap. */}
                <Pressable
                  style={styles.rowBody}
                  onPress={selecting ? () => toggleSelect(row.id) : undefined}
                  disabled={!selecting}
                >
                  <Text style={[type.body, { color: theme.label }]} numberOfLines={1}>
                    {row.note}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Text style={[styles.metaText, { color: theme.secondaryLabel }]}>{row.date}</Text>

                    {row.suggested && name ? (
                      // A guess is drawn as a guess: dashed, amber, sparkled,
                      // with its own accept control. Before this, an 80%-sure
                      // classifier output was pixel-identical to a category the
                      // user had chosen by hand.
                      <>
                        <Pressable
                          onPress={() => setCategoryPickerFor(row.id)}
                          hitSlop={6}
                          disabled={selecting}
                          style={[styles.suggestChip, { borderColor: theme.systemAmber }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Suggested category ${name}. Tap to change.`}
                        >
                          <Ionicons name="sparkles" size={11} color={theme.systemAmber} />
                          <Text style={[styles.metaText, { color: theme.systemAmber }]}>{name}</Text>
                        </Pressable>
                        <IconButton
                          icon="checkmark"
                          size="sm"
                          variant="tonal"
                          onPress={() => acceptSuggestion(row.id)}
                          disabled={selecting}
                          accessibilityLabel={`Accept ${name} for ${row.note}`}
                        />
                      </>
                    ) : (
                      <Pressable
                        onPress={() => setCategoryPickerFor(row.id)}
                        hitSlop={6}
                        disabled={selecting}
                        accessibilityRole="button"
                        accessibilityLabel={name ? `Category ${name}. Tap to change.` : `Set a category for ${row.note}`}
                      >
                        <Text style={[styles.metaText, { color: name ? theme.accent : theme.tertiaryLabel }]}>
                          {name ?? 'Set category'}
                        </Text>
                      </Pressable>
                    )}

                    {row.duplicate && (
                      <Text style={[styles.tag, { color: theme.systemAmber }]}>Already imported</Text>
                    )}
                    {row.recurring && (
                      <Text style={[styles.tag, { color: theme.systemAmber }]}>Recurring bill</Text>
                    )}
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => flipSign(row.id)}
                  hitSlop={6}
                  style={styles.amountBtn}
                  disabled={selecting}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatCurrency(row.amount, currency)}. Tap to flip the sign.`}
                >
                  <Text
                    style={[
                      type.headline,
                      { color: row.amount < 0 ? theme.systemGreen : theme.label },
                    ]}
                  >
                    {formatCurrency(row.amount, currency)}
                  </Text>
                  {!selecting && <Text style={[styles.flipHint, { color: theme.tertiaryLabel }]}>tap ±</Text>}
                </Pressable>
              </View>
            );
          })}
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
        <Button
          label={`Import ${includedCount} transaction${includedCount === 1 ? '' : 's'}`}
          variant="primary"
          size="lg"
          full
          loading={committing}
          disabled={includedCount === 0}
          onPress={commit}
        />
      </View>

      {/* Category picker — one row, or the whole bulk selection. */}
      <SheetModal visible={categoryPickerFor !== null} onRequestClose={() => setCategoryPickerFor(null)}>
        <SafeAreaView style={[styles.flex, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.pickerHeader}>
            <Text style={[type.title2, { color: theme.label }]}>
              {categoryPickerFor === 'bulk' ? `Category for ${selected.size} row${selected.size === 1 ? '' : 's'}` : 'Category'}
            </Text>
            <Pressable onPress={() => setCategoryPickerFor(null)} hitSlop={8}>
              <Text style={[type.headline, { color: theme.accent }]}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView>
            <Pressable
              style={[styles.pickerRow, { borderBottomColor: theme.separator }]}
              onPress={() => applyPickedCategory(null)}
            >
              <Text style={[type.body, { color: theme.secondaryLabel }]}>No category (review later)</Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.pickerRow, { borderBottomColor: theme.separator }]}
                onPress={() => applyPickedCategory(c.id)}
              >
                <View style={[styles.catDot, { backgroundColor: c.color }]} />
                <Text style={[type.body, { color: theme.label }]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </SheetModal>
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
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  toolbarSpacer: { flex: 1 },
  suggestBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  suggestText: { flex: 1, fontSize: 12, lineHeight: 17 },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowExcluded: { opacity: 0.4 },
  checkbox: { width: 30 },
  rowBody: { flex: 1, minWidth: 0 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3, flexWrap: 'wrap' },
  metaText: { fontSize: 13 },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  tag: { fontSize: 12, fontWeight: '600' },
  amountBtn: { alignItems: 'flex-end', minWidth: 84 },
  flipHint: { fontSize: 10, marginTop: 1 },
  skippedHeader: { fontSize: 13, fontWeight: '600', padding: spacing.md, paddingBottom: spacing.sm },
  skippedRow: { paddingHorizontal: spacing.md, paddingVertical: 4 },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  catDot: { width: 14, height: 14, borderRadius: 7 },
});

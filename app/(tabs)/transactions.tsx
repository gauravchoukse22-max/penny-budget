import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, SectionList, ScrollView, Pressable, TextInput, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { TransactionRow } from '../../components/TransactionRow';
import { SwipeToDelete } from '../../components/SwipeToDelete';
import { CategoryIcon } from '../../components/CategoryIcon';
import { MonthSwitcher } from '../../components/MonthSwitcher';
import { Button, IconButton } from '../../components/Button';
import { formatCurrency, formatDayLabel, formatMonthLabel } from '../../lib/format';
import { bulkUpdateCategory, bulkUpdateCard, bulkDeleteTransactions } from '../../features/bulk-actions';
import { confirmAction } from '../../lib/confirm';
import { TagChips } from '../../components/TagPicker';
import { RefundBadge } from '../../components/RefundBadge';
import {
  listTags,
  listTransactionsWithTag,
  sweepOrphanedTransactionTags,
  tagIdsForTransactions,
  type Tag,
} from '../../features/tags';
import { claimsForTransactions, outstandingRefundTotal, type RefundClaim } from '../../features/refunds';
import { sumAmount } from '../../lib/queries';
import type { Category, Transaction } from '../../lib/models';

/**
 * The category filter has three states, not two: every category, one category,
 * or the transactions that have NO category at all. That third state is real
 * data — deleteCategory nulls categoryId rather than deleting the rows — and
 * this screen previously had no way to reach it, so those transactions could
 * only be found from the separate Search screen.
 */
type CategoryFilter = { kind: 'all' } | { kind: 'uncategorized' } | { kind: 'one'; id: string };

const ALL_CATEGORIES: CategoryFilter = { kind: 'all' };

export default function TransactionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, settings, selectedMonth, removeTransaction, refresh } = useBudget();

  const [search, setSearch] = useState('');
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [showFilters, setShowFilters] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<'category' | 'card' | null>(null);

  // ── Tags and refund claims ────────────────────────────────────────────────
  // Loaded here rather than pushed through BudgetContext: the context holds the
  // selected MONTH, and a tag deliberately spans months (a trip that straddles
  // July and August is one trip). Keeping these local is what lets the tag
  // filter below widen the list beyond the selected month without touching how
  // every other screen loads its data.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [taggedTransactions, setTaggedTransactions] = useState<Transaction[]>([]);
  const [tagIdsByTransaction, setTagIdsByTransaction] = useState<Map<string, string[]>>(new Map());
  const [claimsByTransaction, setClaimsByTransaction] = useState<Map<string, RefundClaim>>(new Map());
  const [outstanding, setOutstanding] = useState(0);

  const tagById = new Map(tags.map((t) => [t.id, t]));

  useEffect(() => {
    let alive = true;
    // The tag sweep runs HERE and not inside listTags(). features/tags.ts keeps
    // it as a backstop for the delete paths it cannot reach — bulk delete, and a
    // transaction tombstoned on the other phone — but a backstop nothing calls
    // is not a backstop, and the only other caller (listTagSummaries) is not on
    // any screen yet. This is the screen where an orphan would actually show
    // itself, as a tag chip on a row that no longer exists and a tag total that
    // does not match the transactions listed under it. Costs one SELECT once
    // there is nothing to sweep, which is the steady state.
    Promise.all([sweepOrphanedTransactionTags(), listTags(), outstandingRefundTotal()]).then(
      ([, loadedTags, total]) => {
        if (!alive) return;
        setTags(loadedTags);
        setOutstanding(total);
      }
    );
    return () => {
      alive = false;
    };
    // Re-read whenever the month's transactions change: that is the signal that
    // something was added, edited or deleted, which is exactly when a claim may
    // have been settled or a tag may have stopped being used.
  }, [transactions]);

  // A tag's transactions come from their own query across EVERY month, so the
  // month switcher is hidden while a tag filter is on — see below.
  useEffect(() => {
    if (!tagFilter) {
      setTaggedTransactions([]);
      return;
    }
    let alive = true;
    listTransactionsWithTag(tagFilter).then((rows) => {
      if (alive) setTaggedTransactions(rows);
    });
    return () => {
      alive = false;
    };
  }, [tagFilter, transactions]);

  const baseTransactions = tagFilter ? taggedTransactions : transactions;
  // Keyed on the id list rather than the array identity: `transactions` is a
  // fresh array on every context refresh, and depending on the array itself
  // would re-run these two queries on every unrelated render.
  const baseIdKey = baseTransactions.map((t) => t.id).join(',');

  useEffect(() => {
    let alive = true;
    const ids = baseIdKey ? baseIdKey.split(',') : [];
    Promise.all([tagIdsForTransactions(ids), claimsForTransactions(ids)]).then(([byTag, byClaim]) => {
      if (!alive) return;
      setTagIdsByTransaction(byTag);
      setClaimsByTransaction(byClaim);
    });
    return () => {
      alive = false;
    };
  }, [baseIdKey]);

  const enterSelect = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setPicker(null);
  };

  const selectedArray = () => Array.from(selectedIds);

  const doBulkDelete = async () => {
    const ids = selectedArray();
    if (ids.length === 0) return;
    if (await confirmAction({ title: 'Delete transactions?', message: `Delete ${ids.length} selected transaction(s)? This cannot be undone.`, confirmLabel: 'Delete', destructive: true })) {
      await bulkDeleteTransactions(ids);
      await refresh();
      exitSelect();
    }
  };

  const doBulkCategory = async (categoryId: string | null) => {
    await bulkUpdateCategory(selectedArray(), categoryId);
    await refresh();
    exitSelect();
  };

  const doBulkCard = async (cardId: string) => {
    await bulkUpdateCard(selectedArray(), cardId);
    await refresh();
    exitSelect();
  };

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const filtersActive = cardFilter !== null || categoryFilter.kind !== 'all' || tagFilter !== null;
  const clearFilters = () => {
    setCardFilter(null);
    setCategoryFilter(ALL_CATEGORIES);
    setTagFilter(null);
  };

  // What the collapsed bar says the list is currently showing. Always names both
  // halves, so "All cards · Dining" makes it obvious which one is narrowing the
  // list — the old chip rows showed that by highlighting, and the whole point of
  // collapsing them is that they are no longer on screen.
  const cardFilterLabel = cardFilter ? cardById.get(cardFilter)?.name ?? 'Card' : 'All cards';
  // Appended to the bar's label only when set, so the common case keeps the
  // two-part "All cards · All categories" shape it already has.
  const tagFilterSuffix = tagFilter ? ` · #${tagById.get(tagFilter)?.name ?? 'Tag'}` : '';
  const categoryFilterLabel =
    categoryFilter.kind === 'all'
      ? 'All categories'
      : categoryFilter.kind === 'uncategorized'
        ? 'Uncategorized'
        : categoryById.get(categoryFilter.id)?.name ?? 'Category';
  const activeTag = tagFilter ? tagById.get(tagFilter) : undefined;

  const filtered = useMemo(() => {
    return baseTransactions.filter((t) => {
      if (cardFilter && t.cardId !== cardFilter) return false;
      if (categoryFilter.kind === 'uncategorized' && t.categoryId !== null) return false;
      if (categoryFilter.kind === 'one' && t.categoryId !== categoryFilter.id) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const noteMatch = (t.note ?? '').toLowerCase().includes(q);
        const catMatch = t.categoryId ? (categoryById.get(t.categoryId)?.name ?? '').toLowerCase().includes(q) : false;
        // Amount-as-you-type: "45" finds $45.xx, "45.99" finds $45.99 —
        // prefix match on the absolute amount, so refunds are found too and
        // "45" doesn't surprise-match $145. Tolerates "$" and "," in the query.
        const numericQ = q.replace(/[$,\s]/g, '');
        const amountMatch = /^\d+\.?\d*$/.test(numericQ) && Math.abs(t.amount).toFixed(2).startsWith(numericQ);
        if (!noteMatch && !catMatch && !amountMatch) return false;
      }
      return true;
    });
  }, [baseTransactions, cardFilter, categoryFilter, search]);

  const sections = useMemo(() => {
    const byDay = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const list = byDay.get(t.date) ?? [];
      list.push(t);
      byDay.set(t.date, list);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, data]) => ({ title: date, data }));
  }, [filtered]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      {selectMode ? (
        <View style={styles.headerRow}>
          <Button label="Cancel" onPress={exitSelect} variant="ghost" size="sm" />
          <Text style={[type.headline, { color: theme.label }]}>{selectedIds.size} selected</Text>
          <View style={styles.selectActions}>
            <IconButton
              icon="pricetag-outline"
              onPress={() => setPicker('category')}
              disabled={selectedIds.size === 0}
              variant="tonal"
              accessibilityLabel="Change category of selected transactions"
            />
            <IconButton
              icon="card-outline"
              onPress={() => setPicker('card')}
              disabled={selectedIds.size === 0}
              variant="tonal"
              accessibilityLabel="Move selected transactions to another card"
            />
            <IconButton
              icon="trash-outline"
              onPress={doBulkDelete}
              disabled={selectedIds.size === 0}
              variant="destructive"
              accessibilityLabel="Delete selected transactions"
            />
          </View>
        </View>
      ) : (
        <View style={styles.headerRow}>
          <Text style={[type.title1, { color: theme.label }]}>Transactions</Text>
          <IconButton
            icon="add"
            onPress={() => router.push('/transaction/add')}
            variant="tonal"
            accessibilityLabel="Add transaction"
          />
        </View>
      )}

      {/* Hidden in select mode: the header above has already become a selection
          toolbar, and changing month mid-selection would leave the user holding
          ids they can no longer see.

          Also hidden while a tag filter is on, for the same reason: that list
          spans every month, so a month switcher would be a control that visibly
          does nothing. The banner below says so in words rather than leaving
          the user to infer it from a missing widget. */}
      {!selectMode && !tagFilter && <MonthSwitcher style={styles.monthSwitcher} />}

      {/* The point of tags, stated as a number: what this label costs across
          every category and every month. Totals the DISPLAYED rows, so it can
          never disagree with the list underneath it when a card or category
          filter is also on. */}
      {activeTag && !selectMode && (
        <View style={[styles.tagBanner, { backgroundColor: theme.card }]}>
          <View style={[styles.tagBannerDot, { backgroundColor: activeTag.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.label, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
              {activeTag.name}
            </Text>
            <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>
              {filtered.length} transaction{filtered.length === 1 ? '' : 's'} · all months
            </Text>
          </View>
          <Text style={{ color: theme.label, fontWeight: '700', fontSize: 17 }}>
            {formatCurrency(sumAmount(filtered), settings.currency)}
          </Text>
        </View>
      )}

      {/* Money the user is owed, surfaced where they will actually see it. A
          refund that never arrives is invisible by nature — the charge looks
          like any other — so the only thing that recovers it is a total that
          stays on screen. Hidden at zero rather than showing "$0.00 owed",
          which is noise. */}
      {outstanding > 0 && !selectMode && !tagFilter && (
        <View style={[styles.outstandingBanner, { backgroundColor: theme.card }]}>
          <Ionicons name="hourglass-outline" size={15} color={theme.systemAmber} />
          <Text style={{ color: theme.secondaryLabel, fontSize: 13, flex: 1 }}>Awaiting refunds</Text>
          <Text style={{ color: theme.systemAmber, fontWeight: '700', fontSize: 15 }}>
            {formatCurrency(outstanding, settings.currency)}
          </Text>
        </View>
      )}

      <View style={[styles.searchBox, { backgroundColor: theme.fieldBackground }]}>
        <Ionicons name="search" size={16} color={theme.tertiaryLabel} />
        <TextInput
          style={[styles.searchInput, { color: theme.label }]}
          placeholder="Search merchant, category, or amount"
          placeholderTextColor={theme.tertiaryLabel}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* One collapsed row instead of two wrapping chip rows. With 9 cards and
          12 categories those rows ran ~7 lines deep and pushed the list most of
          the way down the screen — the user saw filters, not transactions. */}
      <View style={styles.filterBarRow}>
        <Button
          label={`${cardFilterLabel} · ${categoryFilterLabel}${tagFilterSuffix}`}
          onPress={() => setShowFilters(true)}
          variant={filtersActive ? 'tonal' : 'glass'}
          size="sm"
          icon="funnel"
          iconAfter="chevron-down"
          style={styles.filterBar}
          accessibilityLabel={`Filters: ${cardFilterLabel}, ${categoryFilterLabel}${tagFilterSuffix}. Tap to change.`}
        />
        {/* Only rendered while something is actually filtered, so "Clear" is
            never a dead control — and when it IS there it sits outside the
            sheet, one tap from the list. */}
        {filtersActive && <Button label="Clear" onPress={clearFilters} variant="ghost" size="sm" />}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        // Without this the first tap on a row while the search keyboard is up
        // only dismisses the keyboard, so opening a result takes two taps.
        keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: theme.secondaryLabel, backgroundColor: theme.groupedBackground }]}>
            {formatDayLabel(section.title)}
          </Text>
        )}
        renderItem={({ item }) => {
          // Rendered UNDER the row rather than inside it: components/
          // TransactionRow.tsx is shared with Search, the category screen and
          // the card screen, and widening it for this would change all of them.
          // This keeps the row exactly as it is and adds a second line only when
          // there is something to say.
          const itemTags = (tagIdsByTransaction.get(item.id) ?? []).flatMap((id) => tagById.get(id) ?? []);
          const claim = claimsByTransaction.get(item.id);
          const hasMeta = itemTags.length > 0 || claim?.status === 'awaiting';
          const row = (
            <View style={{ backgroundColor: theme.groupedBackground, paddingHorizontal: 4 }}>
              <TransactionRow
                transaction={item}
                category={item.categoryId ? categoryById.get(item.categoryId) : undefined}
                card={cardById.get(item.cardId)}
                currency={settings.currency}
                selectable={selectMode}
                selected={selectedIds.has(item.id)}
                onLongPress={() => !selectMode && enterSelect(item.id)}
                onPress={() => (selectMode ? toggleSelect(item.id) : router.push(`/transaction/${item.id}`))}
              />
              {hasMeta && (
                <View style={styles.rowMeta}>
                  <TagChips tags={itemTags} size="sm" />
                  <RefundBadge claim={claim} currency={settings.currency} />
                </View>
              )}
            </View>
          );
          // No confirmation: one transaction deletes only itself, and the
          // swipe already takes two deliberate actions. Bulk delete keeps its
          // dialog because that one removes many rows at once.
          return (
            <SwipeToDelete
              enabled={!selectMode}
              onDelete={() => removeTransaction(item.id)}
              accessibilityLabel={`Delete transaction ${item.note ?? 'without a note'}`}
              actionStyle={styles.deleteAction}
            >
              {row}
            </SwipeToDelete>
          );
        }}
        ListEmptyComponent={
          // With the filters collapsed into a bar, an empty list is much easier
          // to misread as "I have no transactions". Say which it is, and put the
          // way out right here.
          <View style={styles.emptyState}>
            <Text style={{ color: theme.tertiaryLabel, textAlign: 'center' }}>
              {filtersActive || search.trim()
                ? `No transactions match these filters in ${formatMonthLabel(selectedMonth)}`
                : `No transactions in ${formatMonthLabel(selectedMonth)}`}
            </Text>
            {filtersActive && <Button label="Clear filters" onPress={clearFilters} variant="ghost" size="sm" />}
          </View>
        }
      />

      <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
          <Text style={[type.title2, { color: theme.label, marginBottom: spacing.lg }]}>
            {picker === 'category' ? 'Move to category' : 'Move to card'}
          </Text>
          <ScrollView>
            {picker === 'category' && (
              <>
                {categories.map((c) => (
                  <Pressable key={c.id} style={styles.pickerRow} onPress={() => doBulkCategory(c.id)}>
                    <CategoryIcon icon={c.icon} color={c.color} size={18} />
                    <Text style={{ color: theme.label, fontSize: 16 }}>{c.name}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.pickerRow} onPress={() => doBulkCategory(null)}>
                  <Ionicons name="close-circle-outline" size={20} color={theme.tertiaryLabel} />
                  <Text style={{ color: theme.secondaryLabel, fontSize: 16 }}>Uncategorized</Text>
                </Pressable>
              </>
            )}
            {picker === 'card' &&
              cards.map((c) => (
                <Pressable key={c.id} style={styles.pickerRow} onPress={() => doBulkCard(c.id)}>
                  <View style={[styles.cardDot, { backgroundColor: c.color }]} />
                  <Text style={{ color: theme.label, fontSize: 16 }}>{c.name}</Text>
                </Pressable>
              ))}
          </ScrollView>
          <Button label="Cancel" onPress={() => setPicker(null)} variant="glass" full style={styles.modalFooterButton} />
        </View>
      </Modal>

      {/* The filters themselves. Every option the old chip rows had is here,
          plus Uncategorized — nothing was dropped, it just stopped being
          permanently on screen. Selections apply live rather than on a Done
          button, so the bar behind the sheet updates as you tap and the choice
          is confirmed by what you see, not by a second action. */}
      <Modal
        visible={showFilters}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilters(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHeader}>
            <Text style={[type.title2, { color: theme.label }]}>Filter</Text>
            {filtersActive && <Button label="Clear all" onPress={clearFilters} variant="ghost" size="sm" />}
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.sheetSection, { color: theme.secondaryLabel }]}>CARD</Text>
            <OptionRow
              label="All cards"
              selected={cardFilter === null}
              onPress={() => setCardFilter(null)}
              leading={<Ionicons name="albums-outline" size={18} color={theme.secondaryLabel} />}
            />
            {cards.map((c) => (
              <OptionRow
                key={c.id}
                label={c.name}
                selected={cardFilter === c.id}
                onPress={() => setCardFilter(c.id)}
                leading={<View style={[styles.cardDot, { backgroundColor: c.color }]} />}
              />
            ))}

            <Text style={[styles.sheetSection, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>CATEGORY</Text>
            <OptionRow
              label="All categories"
              selected={categoryFilter.kind === 'all'}
              onPress={() => setCategoryFilter(ALL_CATEGORIES)}
              leading={<Ionicons name="apps-outline" size={18} color={theme.secondaryLabel} />}
            />
            <OptionRow
              label="Uncategorized"
              selected={categoryFilter.kind === 'uncategorized'}
              onPress={() => setCategoryFilter({ kind: 'uncategorized' })}
              leading={<Ionicons name="help-circle-outline" size={18} color={theme.secondaryLabel} />}
            />
            {categories.map((c: Category) => (
              <OptionRow
                key={c.id}
                label={c.name}
                selected={categoryFilter.kind === 'one' && categoryFilter.id === c.id}
                onPress={() => setCategoryFilter({ kind: 'one', id: c.id })}
                leading={<CategoryIcon icon={c.icon} color={c.color} size={18} />}
              />
            ))}

            {/* Only rendered once the user has a tag. An empty TAG section
                would be a heading over nothing on every install that never uses
                the feature. */}
            {tags.length > 0 && (
              <>
                <Text style={[styles.sheetSection, { color: theme.secondaryLabel, marginTop: spacing.lg }]}>TAG</Text>
                {/* Says what picking one DOES, because it behaves differently
                    from the two filters above it — it leaves the selected month
                    behind, and that is the whole point rather than a side
                    effect. */}
                <Text style={[styles.sheetNote, { color: theme.tertiaryLabel }]}>
                  Picking a tag searches every month, not just {formatMonthLabel(selectedMonth)}.
                </Text>
                <OptionRow
                  label="Any tag"
                  selected={tagFilter === null}
                  onPress={() => setTagFilter(null)}
                  leading={<Ionicons name="pricetags-outline" size={18} color={theme.secondaryLabel} />}
                />
                {tags.map((t) => (
                  <OptionRow
                    key={t.id}
                    label={t.name}
                    selected={tagFilter === t.id}
                    onPress={() => setTagFilter(t.id)}
                    leading={<View style={[styles.cardDot, { backgroundColor: t.color }]} />}
                  />
                ))}
              </>
            )}
          </ScrollView>
          <Button
            label={`Show ${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`}
            onPress={() => setShowFilters(false)}
            variant="primary"
            full
            style={styles.modalFooterButton}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** One selectable line in the filter sheet — a full-width tap target with the
 * selection shown as a checkmark, so it reads the same for cards, categories
 * and the "all" rows without needing a different chip color per option. */
function OptionRow({
  label,
  selected,
  onPress,
  leading,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  leading: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.optionRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.optionLeading}>{leading}</View>
      <Text
        style={[styles.optionLabel, { color: theme.label, fontWeight: selected ? '700' : '400' }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected && <Ionicons name="checkmark" size={19} color={theme.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  monthSwitcher: { marginTop: spacing.xs, marginHorizontal: spacing.lg },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  // Kept short (Button `sm`) so the whole filter control is one line. The two
  // wrapping chip rows it replaces ran roughly 200pt on this user's data.
  filterBar: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 },
  sectionHeader: { fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  deleteAction: { marginVertical: 4 },
  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: 40 },
  selectActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  modalContent: { flex: 1, padding: spacing.xl, paddingTop: 40 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sheetSection: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.xs },
  sheetNote: { fontSize: 12, lineHeight: 16, marginBottom: spacing.xs },
  // Sits under the row, indented past the category icon so it reads as belonging
  // to the transaction above rather than as its own list item.
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingLeft: 48,
    paddingRight: spacing.sm,
    paddingBottom: 6,
    marginTop: -4,
  },
  tagBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  tagBannerDot: { width: 10, height: 10, borderRadius: 5 },
  outstandingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  // 44pt tall including padding — Apple's minimum tap target, and the reason
  // these are rows rather than the denser chips they replace.
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  optionLeading: { width: 20, alignItems: 'center' },
  optionLabel: { flex: 1, fontSize: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  cardDot: { width: 18, height: 18, borderRadius: 9 },
  modalFooterButton: { marginTop: spacing.md },
});

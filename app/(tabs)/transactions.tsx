import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, SectionList, ScrollView, Pressable, TextInput, Alert, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { TransactionRow } from '../../components/TransactionRow';
import { CategoryIcon } from '../../components/CategoryIcon';
import { formatDayLabel } from '../../lib/format';
import { bulkUpdateCategory, bulkUpdateCard, bulkDeleteTransactions } from '../../features/bulk-actions';
import type { Transaction } from '../../lib/models';

export default function TransactionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, settings, removeTransaction, refresh } = useBudget();

  const [search, setSearch] = useState('');
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<'category' | 'card' | null>(null);

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

  const doBulkDelete = () => {
    const ids = selectedArray();
    if (ids.length === 0) return;
    Alert.alert('Delete transactions?', `Delete ${ids.length} selected transaction(s)? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await bulkDeleteTransactions(ids);
          await refresh();
          exitSelect();
        },
      },
    ]);
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

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (cardFilter && t.cardId !== cardFilter) return false;
      if (categoryFilter && t.categoryId !== categoryFilter) return false;
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
  }, [transactions, cardFilter, categoryFilter, search]);

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

  const confirmDelete = (t: Transaction) => {
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeTransaction(t.id) },
    ]);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
        {selectMode ? (
          <View style={styles.headerRow}>
            <Pressable onPress={exitSelect} hitSlop={8}>
              <Text style={{ color: theme.accent, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Text style={[type.headline, { color: theme.label }]}>{selectedIds.size} selected</Text>
            <View style={styles.selectActions}>
              <Pressable onPress={() => selectedIds.size > 0 && setPicker('category')} hitSlop={8}>
                <Ionicons name="pricetag-outline" size={24} color={selectedIds.size > 0 ? theme.accent : theme.tertiaryLabel} />
              </Pressable>
              <Pressable onPress={() => selectedIds.size > 0 && setPicker('card')} hitSlop={8}>
                <Ionicons name="card-outline" size={24} color={selectedIds.size > 0 ? theme.accent : theme.tertiaryLabel} />
              </Pressable>
              <Pressable onPress={doBulkDelete} hitSlop={8}>
                <Ionicons name="trash-outline" size={24} color={selectedIds.size > 0 ? theme.systemRed : theme.tertiaryLabel} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <Text style={[type.title1, { color: theme.label }]}>Transactions</Text>
            <Pressable onPress={() => router.push('/transaction/add')} hitSlop={8}>
              <Ionicons name="add-circle" size={30} color={theme.accent} />
            </Pressable>
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

        <View style={styles.filterRow}>
          <FilterChip label="All Cards" active={!cardFilter} onPress={() => setCardFilter(null)} />
          {cards.map((c) => (
            <FilterChip key={c.id} label={c.name} active={cardFilter === c.id} onPress={() => setCardFilter(c.id)} color={c.color} />
          ))}
        </View>
        <View style={styles.filterRow}>
          <FilterChip label="All Categories" active={!categoryFilter} onPress={() => setCategoryFilter(null)} />
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              label={c.name}
              active={categoryFilter === c.id}
              onPress={() => setCategoryFilter(c.id)}
              color={c.color}
            />
          ))}
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: theme.secondaryLabel, backgroundColor: theme.groupedBackground }]}>
              {formatDayLabel(section.title)}
            </Text>
          )}
          renderItem={({ item }) => {
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
              </View>
            );
            if (selectMode) return row;
            return (
              <Swipeable
                renderRightActions={() => (
                  <Pressable style={[styles.deleteAction, { backgroundColor: theme.systemRed }]} onPress={() => confirmDelete(item)}>
                    <Ionicons name="trash" size={20} color="#FFF" />
                  </Pressable>
                )}
              >
                {row}
              </Swipeable>
            );
          }}
          ListEmptyComponent={
            <Text style={{ color: theme.tertiaryLabel, textAlign: 'center', marginTop: 40 }}>No transactions found</Text>
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
            <Pressable style={[styles.modalCancel, { borderColor: theme.separator }]} onPress={() => setPicker(null)}>
              <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  const theme = useTheme();
  const activeColor = color ?? theme.accent;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? activeColor : theme.fieldBackground }]}
    >
      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : theme.secondaryLabel }]} numberOfLines={1}>
        {label}
      </Text>
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 },
  sectionHeader: { fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: radius.md,
    marginVertical: 4,
  },
  selectActions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  modalContent: { flex: 1, padding: spacing.xl, paddingTop: 40 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  cardDot: { width: 18, height: 18, borderRadius: 9 },
  modalCancel: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, marginTop: spacing.md },
});

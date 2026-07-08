import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, SectionList, Pressable, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { TransactionRow } from '../../components/TransactionRow';
import { formatDayLabel } from '../../lib/format';
import type { Transaction } from '../../lib/models';

export default function TransactionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { transactions, categories, cards, settings, removeTransaction } = useBudget();

  const [search, setSearch] = useState('');
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

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
        if (!noteMatch && !catMatch) return false;
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
        <View style={styles.headerRow}>
          <Text style={[type.title1, { color: theme.label }]}>Transactions</Text>
          <Pressable onPress={() => router.push('/transaction/add')} hitSlop={8}>
            <Ionicons name="add-circle" size={30} color={theme.accent} />
          </Pressable>
        </View>

        <View style={[styles.searchBox, { backgroundColor: theme.fieldBackground }]}>
          <Ionicons name="search" size={16} color={theme.tertiaryLabel} />
          <TextInput
            style={[styles.searchInput, { color: theme.label }]}
            placeholder="Search merchant or category"
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
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={() => (
                <Pressable style={[styles.deleteAction, { backgroundColor: theme.systemRed }]} onPress={() => confirmDelete(item)}>
                  <Ionicons name="trash" size={20} color="#FFF" />
                </Pressable>
              )}
            >
              <View style={{ backgroundColor: theme.groupedBackground, paddingHorizontal: 4 }}>
                <TransactionRow
                  transaction={item}
                  category={item.categoryId ? categoryById.get(item.categoryId) : undefined}
                  card={cardById.get(item.cardId)}
                  currency={settings.currency}
                  onPress={() => router.push(`/transaction/${item.id}`)}
                />
              </View>
            </Swipeable>
          )}
          ListEmptyComponent={
            <Text style={{ color: theme.tertiaryLabel, textAlign: 'center', marginTop: 40 }}>No transactions found</Text>
          }
        />
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
});

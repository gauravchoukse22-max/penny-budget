import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useBudget } from '../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { Surface } from '../components/Surface';
import { TransactionRow } from '../components/TransactionRow';
import { searchTransactions, type SearchFilters } from '../features/search-engine';
import type { Transaction } from '../lib/models';
import { parseMoneyInput } from '../lib/parse-number';

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { categories, cards, settings } = useBudget();

  const [query, setQuery] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null | undefined>(undefined);
  const [cardId, setCardId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [results, setResults] = useState<Transaction[] | null>(null);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const runSearch = async () => {
    const filters: SearchFilters = { limit: 200 };
    if (query.trim()) filters.query = query.trim();
    const min = parseMoneyInput(minAmount);
    const max = parseMoneyInput(maxAmount);
    if (min !== null) filters.minAmount = min;
    if (max !== null) filters.maxAmount = max;
    if (categoryId !== undefined) filters.categoryId = categoryId;
    if (cardId !== undefined) filters.cardId = cardId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    setResults(await searchTransactions(filters));
  };

  return (
    <ScrollView style={{ backgroundColor: theme.groupedBackground }} contentContainerStyle={styles.content}>
      <Surface>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Search note / merchant"
          placeholderTextColor={theme.tertiaryLabel}
          value={query}
          onChangeText={setQuery}
        />
        <View style={styles.inlineRow}>
          <TextInput
            style={[styles.input, styles.flex1, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Min $"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={minAmount}
            onChangeText={setMinAmount}
          />
          <TextInput
            style={[styles.input, styles.flex1, { backgroundColor: theme.fieldBackground, color: theme.label }]}
            placeholder="Max $"
            placeholderTextColor={theme.tertiaryLabel}
            keyboardType="numeric"
            value={maxAmount}
            onChangeText={setMaxAmount}
          />
        </View>

        <View style={styles.inlineRow}>
          <Pressable
            style={[styles.dateBox, styles.flex1, { backgroundColor: theme.fieldBackground }]}
            onPress={() => setPicking('start')}
          >
            <Text style={{ color: startDate ? theme.label : theme.tertiaryLabel }}>{startDate ?? 'From date'}</Text>
          </Pressable>
          <Pressable
            style={[styles.dateBox, styles.flex1, { backgroundColor: theme.fieldBackground }]}
            onPress={() => setPicking('end')}
          >
            <Text style={{ color: endDate ? theme.label : theme.tertiaryLabel }}>{endDate ?? 'To date'}</Text>
          </Pressable>
        </View>
        {(startDate || endDate) && (
          <Pressable onPress={() => { setStartDate(undefined); setEndDate(undefined); }}>
            <Text style={{ color: theme.accent, fontSize: 13, marginBottom: 8 }}>Clear dates</Text>
          </Pressable>
        )}
        {picking && (
          <DateTimePicker
            value={new Date((picking === 'start' ? startDate : endDate) ? `${picking === 'start' ? startDate : endDate}T00:00:00` : Date.now())}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_, selected) => {
              const which = picking;
              setPicking(Platform.OS === 'ios' ? picking : null);
              if (selected) {
                if (which === 'start') setStartDate(isoOf(selected));
                else setEndDate(isoOf(selected));
              }
              if (Platform.OS === 'ios') setPicking(null);
            }}
          />
        )}

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Category</Text>
        <View style={styles.chipRow}>
          <Chip label="Any" active={categoryId === undefined} onPress={() => setCategoryId(undefined)} />
          <Chip label="Uncategorized" active={categoryId === null} onPress={() => setCategoryId(null)} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} active={categoryId === c.id} color={c.color} onPress={() => setCategoryId(c.id)} />
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Card</Text>
        <View style={styles.chipRow}>
          <Chip label="Any" active={cardId === undefined} onPress={() => setCardId(undefined)} />
          {cards.map((c) => (
            <Chip key={c.id} label={c.name} active={cardId === c.id} color={c.color} onPress={() => setCardId(c.id)} />
          ))}
        </View>

        <Pressable style={[styles.searchButton, { backgroundColor: theme.accent }]} onPress={runSearch}>
          <Ionicons name="search" size={16} color="#FFF" />
          <Text style={{ color: '#FFF', fontWeight: '600' }}>Search</Text>
        </Pressable>
      </Surface>

      {results !== null && (
        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>
            {results.length} result{results.length === 1 ? '' : 's'}
          </Text>
          {results.length === 0 ? (
            <Text style={{ color: theme.tertiaryLabel }}>No transactions match those filters.</Text>
          ) : (
            results.map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
                card={cardById.get(t.cardId)}
                currency={settings.currency}
                onPress={() => router.push(`/transaction/${t.id}`)}
              />
            ))
          )}
        </Surface>
      )}
    </ScrollView>
  );
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  const theme = useTheme();
  const activeColor = color ?? theme.accent;
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? activeColor : theme.fieldBackground }]}>
      <Text style={{ color: active ? '#FFF' : theme.secondaryLabel, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginBottom: 10 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  dateBox: { padding: 12, borderRadius: radius.sm, marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md },
  searchButton: { flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
});

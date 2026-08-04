import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useBudget } from '../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../theme/colors';
import { Surface } from '../components/Surface';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';
import { TransactionRow } from '../components/TransactionRow';
import { Button, Chip } from '../components/Button';
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
    <KeyboardAwareScreen
      backgroundColor={theme.groupedBackground}
      contentContainerStyle={styles.content}
    >
      <Surface>
        <TextInput
          style={[styles.input, { backgroundColor: theme.fieldBackground, color: theme.label }]}
          placeholder="Search note, merchant, or amount"
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
          <Button
            label="Clear dates"
            onPress={() => { setStartDate(undefined); setEndDate(undefined); }}
            variant="ghost"
            size="sm"
            style={styles.clearDates}
          />
        )}
        {picking && (
          <View>
            <DateTimePicker
              value={new Date((picking === 'start' ? startDate : endDate) ? `${picking === 'start' ? startDate : endDate}T00:00:00` : Date.now())}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(event, selected) => {
                if (Platform.OS === 'android') {
                  // Android's picker is a modal dialog that reports one
                  // outcome — set or dismissed — so it closes either way.
                  const which = picking;
                  setPicking(null);
                  if (event.type === 'set' && selected) {
                    if (which === 'start') setStartDate(isoOf(selected));
                    else setEndDate(isoOf(selected));
                  }
                  return;
                }
                // iOS's inline calendar fires onChange for every interaction,
                // paging between months included. Closing the picker here — as
                // this did — meant it vanished the moment you changed month and
                // there was no way to reach a day. It now stays open until Done.
                if (selected) {
                  if (picking === 'start') setStartDate(isoOf(selected));
                  else setEndDate(isoOf(selected));
                }
              }}
            />
            {Platform.OS === 'ios' && (
              <Button
                label="Done"
                onPress={() => setPicking(null)}
                variant="ghost"
                size="sm"
                style={styles.pickerDone}
                accessibilityLabel="Done choosing date"
              />
            )}
          </View>
        )}

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Category</Text>
        <View style={styles.chipRow}>
          <Chip label="Any" selected={categoryId === undefined} onPress={() => setCategoryId(undefined)} size="sm" />
          <Chip label="Uncategorized" selected={categoryId === null} onPress={() => setCategoryId(null)} size="sm" />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} size="sm" />
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: theme.secondaryLabel }]}>Card</Text>
        <View style={styles.chipRow}>
          <Chip label="Any" selected={cardId === undefined} onPress={() => setCardId(undefined)} size="sm" />
          {cards.map((c) => (
            <Chip key={c.id} label={c.name} selected={cardId === c.id} onPress={() => setCardId(c.id)} size="sm" />
          ))}
        </View>

        <Button label="Search" icon="search" onPress={runSearch} variant="primary" style={styles.searchButton} />
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
                showDate
                onPress={() => router.push(`/transaction/${t.id}`)}
              />
            ))
          )}
        </Surface>
      )}
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  input: { padding: 12, borderRadius: radius.sm, fontSize: 15, marginBottom: 10 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  dateBox: { padding: 12, borderRadius: radius.sm, marginBottom: 10 },
  pickerDone: { alignSelf: 'flex-end', marginBottom: 6 },
  clearDates: { alignSelf: 'flex-start', marginBottom: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  searchButton: { marginTop: spacing.md },
});

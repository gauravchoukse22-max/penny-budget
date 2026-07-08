import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { listAllTransactions } from '../../lib/queries';
import { exportTransactionsCsv, importTransactionsCsv, importParticularsCsv } from '../../lib/csv';
import { formatMonthLabel } from '../../lib/format';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings, categories, cards, selectedMonth, updateSettings, refresh } = useBudget();
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const all = await listAllTransactions();
      await exportTransactionsCsv(all, categories, cards);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const result = await importTransactionsCsv();
      if (result) {
        Alert.alert('Import complete', `Imported ${result.imported} transactions, skipped ${result.skipped}.`);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const doImportParticulars = async () => {
    setBusy(true);
    try {
      const result = await importParticularsCsv(selectedMonth);
      if (result) {
        const notes = [
          `Imported ${result.imported} line items into ${formatMonthLabel(selectedMonth)}.`,
          result.savingsTransfers > 0 ? `${result.savingsTransfers} savings transfer(s) excluded from spend.` : null,
          result.uncategorized > 0 ? `${result.uncategorized} item(s) need a category — review under Uncategorized.` : null,
          'All items went to the "Unassigned (imported)" card — reassign per-row if needed.',
        ].filter(Boolean);
        Alert.alert('Import complete', notes.join('\n'));
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBackground }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[type.title1, { color: theme.label }]}>Settings</Text>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Currency</Text>
          <View style={styles.row}>
            {CURRENCIES.map((cur) => (
              <Pressable
                key={cur}
                onPress={() => updateSettings({ currency: cur })}
                style={[styles.chip, { backgroundColor: settings.currency === cur ? theme.accent : theme.fieldBackground }]}
              >
                <Text style={{ color: settings.currency === cur ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>{cur}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            Changes only the display symbol — does not convert historical amounts.
          </Text>
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Manage</Text>
          <SettingsLink label="Categories" onPress={() => router.push('/(tabs)/budget')} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink label="Cards" onPress={() => router.push('/(tabs)/cards')} />
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Data</Text>
          <Pressable style={styles.actionRow} onPress={doExport} disabled={busy}>
            <Ionicons name="download-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Export CSV</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <Pressable style={styles.actionRow} onPress={doImport} disabled={busy}>
            <Ionicons name="cloud-upload-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Import CSV</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <Pressable style={styles.actionRow} onPress={doImportParticulars} disabled={busy}>
            <Ionicons name="list-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Import Monthly Log</Text>
          </Pressable>
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            For a line-item sheet (name + amount per row, no dates or cards) — everything lands in{' '}
            {formatMonthLabel(selectedMonth)} on a shared "Unassigned" card.
          </Text>
        </Surface>

        <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>Penny Budget — local-only, your data stays on this device.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable style={styles.actionRow} onPress={onPress}>
      <Text style={{ color: theme.label, flex: 1, fontSize: 15 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={theme.tertiaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md },
  hint: { fontSize: 12, marginTop: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 8 },
});

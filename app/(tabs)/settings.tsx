import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Switch, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBudget } from '../../context/BudgetContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme, spacing, radius, type } from '../../theme/colors';
import { Surface } from '../../components/Surface';
import { listAllTransactions } from '../../lib/queries';
import { exportTransactionsCsv, importTransactionsCsv, importParticularsCsv } from '../../lib/csv';
import { exportDatabaseToJson, importDatabaseFromJson } from '../../features/backup-restore';
import { checkBiometricsSupport, authenticateUser } from '../../features/biometrics';
import { pickAndParseStatement } from '../../features/statement-import';
import { setPendingImport } from '../../features/import-preview-store';
import { formatMonthLabel } from '../../lib/format';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];

const GRACE_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings, categories, cards, selectedMonth, updateSettings, refresh } = useBudget();
  const { isConfigured: cloudConfigured, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [biometricType, setBiometricType] = useState<string | null>(null);
  const [pickingCardFor, setPickingCardFor] = useState(false);

  useEffect(() => {
    checkBiometricsSupport().then((s) => setBiometricType(s.supported ? s.type : null));
  }, []);

  const toggleBiometricLock = async (value: boolean) => {
    if (value) {
      // Require a successful auth before turning the lock on, so a user can't
      // accidentally lock themselves out with an enrollment that doesn't work.
      const ok = await authenticateUser('Confirm to enable app lock');
      if (!ok) return;
    }
    await updateSettings({ biometricLock: value });
  };

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

  const doBackup = async () => {
    setBusy(true);
    try {
      const ok = await exportDatabaseToJson();
      if (!ok) Alert.alert('Backup unavailable', 'Sharing is not available on this device.');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = () => {
    Alert.alert(
      'Restore from backup?',
      'This replaces ALL current data in the app with the contents of the backup file. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file & restore',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await importDatabaseFromJson();
              Alert.alert(result.success ? 'Restore complete' : 'Restore failed', result.message);
              if (result.success) await refresh();
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const doImportStatement = async (cardId: string) => {
    setPickingCardFor(false);
    setBusy(true);
    try {
      const result = await pickAndParseStatement();
      if (result === null) return; // user cancelled the file picker
      if ('pdfUnsupported' in result) {
        Alert.alert('PDF import unavailable', result.reason);
        return;
      }
      if ('unrecognizedFormat' in result) {
        Alert.alert(
          'Unrecognized format',
          "Couldn't find date, description, and amount columns in that file. Export it as a CSV with those columns and try again."
        );
        return;
      }
      if (result.rows.length === 0) {
        const reason = result.skipped.length > 0
          ? `All ${result.skipped.length} row(s) were skipped — nothing matched a date + amount.`
          : 'No transactions were found in that file.';
        Alert.alert('Nothing to import', reason);
        return;
      }
      // Hand off to the preview screen for review before anything is written.
      setPendingImport({ cardId, preview: result });
      router.push('/import/preview');
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
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Account</Text>
          <SettingsLink
            label={cloudConfigured && user ? `Signed in as ${user.email}` : 'Sign In / Create Account'}
            onPress={() => router.push('/account')}
          />
          {cloudConfigured && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.separator }]} />
              <SettingsLink
                label={settings.householdId ? 'Family Sharing — on' : 'Family Sharing'}
                onPress={() => router.push('/household')}
              />
            </>
          )}
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Manage</Text>
          <SettingsLink label="Categories" onPress={() => router.push('/(tabs)/budget')} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink label="Cards" onPress={() => router.push('/(tabs)/cards')} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink label="Recurring Bills" onPress={() => router.push('/recurring')} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink label="Search Transactions" onPress={() => router.push('/search')} />
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Security</Text>

          {biometricType && (
            <>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.label, fontSize: 15 }}>Require {biometricType}</Text>
                  <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: 2 }}>Lock the app when opened or reopened.</Text>
                </View>
                <Switch value={settings.biometricLock} onValueChange={toggleBiometricLock} />
              </View>

              {settings.biometricLock && (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: theme.secondaryLabel, fontSize: 13, marginBottom: 6 }}>Lock after</Text>
                  <View style={styles.row}>
                    {GRACE_OPTIONS.map((opt) => (
                      <Pressable
                        key={opt.value}
                        onPress={() => updateSettings({ autoLockGraceMinutes: opt.value })}
                        style={[styles.chip, { backgroundColor: settings.autoLockGraceMinutes === opt.value ? theme.accent : theme.fieldBackground }]}
                      >
                        <Text style={{ color: settings.autoLockGraceMinutes === opt.value ? '#FFFFFF' : theme.secondaryLabel, fontWeight: '700' }}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              <View style={[styles.divider, { backgroundColor: theme.separator, marginVertical: 12 }]} />
            </>
          )}

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.label, fontSize: 15 }}>Hide amounts</Text>
              <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: 2 }}>
                Mask money figures (shown as {'••••'}) to keep them private over your shoulder.
              </Text>
            </View>
            <Switch value={settings.hideAmounts} onValueChange={(v) => updateSettings({ hideAmounts: v })} />
          </View>
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
          <View style={[styles.divider, { backgroundColor: theme.separator, marginTop: 10 }]} />
          <Pressable
            style={styles.actionRow}
            onPress={() => (cards.length > 0 ? setPickingCardFor(true) : Alert.alert('Add a card first'))}
            disabled={busy}
          >
            <Ionicons name="albums-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Import Credit Card Statement</Text>
          </Pressable>
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            Works with a CSV export or the PDF statement itself. You'll review and confirm every transaction before
            anything is added — duplicates and recurring bills are flagged for you.
          </Text>
        </Surface>

        {Platform.OS === 'ios' && (
          <Surface>
            <Text style={[styles.sectionTitle, { color: theme.label }]}>iCloud Sync</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.tertiaryLabel, fontSize: 15 }}>Sync across devices</Text>
                <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: 2 }}>
                  Coming in a future update. For now, use the optional account above to back up and restore
                  between devices.
                </Text>
              </View>
              <Switch value={false} disabled />
            </View>
          </Surface>
        )}

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Backup</Text>
          <Pressable style={styles.actionRow} onPress={doBackup} disabled={busy}>
            <Ionicons name="save-outline" size={20} color={theme.accent} />
            <Text style={{ color: theme.accent, marginLeft: 10, fontWeight: '600' }}>Back up all data (JSON)</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <Pressable style={styles.actionRow} onPress={doRestore} disabled={busy}>
            <Ionicons name="refresh-outline" size={20} color={theme.systemRed} />
            <Text style={{ color: theme.systemRed, marginLeft: 10, fontWeight: '600' }}>Restore from backup</Text>
          </Pressable>
          <Text style={[styles.hint, { color: theme.tertiaryLabel }]}>
            A full snapshot of every category, card, transaction, budget, and goal. Restoring replaces all current data.
          </Text>
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>About</Text>
          <SettingsLink label="What's New" onPress={() => router.push('/whats-new')} />
        </Surface>

        <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
          Penny Budget — your data stays on this device unless you turn on an optional account and back it up.
        </Text>
      </ScrollView>

      <Modal visible={pickingCardFor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickingCardFor(false)}>
        <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
          <Text style={[type.title2, { color: theme.label, marginBottom: spacing.lg }]}>Which card is this statement for?</Text>
          <ScrollView>
            {cards.map((c) => (
              <Pressable key={c.id} style={styles.pickerRow} onPress={() => doImportStatement(c.id)}>
                <View style={[styles.cardDot, { backgroundColor: c.color }]} />
                <Text style={{ color: theme.label, fontSize: 16 }}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={[styles.modalCancel, { borderColor: theme.separator }]} onPress={() => setPickingCardFor(false)}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 8 },
  modalContent: { flex: 1, padding: spacing.xl, paddingTop: 40 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  cardDot: { width: 18, height: 18, borderRadius: 9 },
  modalCancel: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, marginTop: spacing.md },
});

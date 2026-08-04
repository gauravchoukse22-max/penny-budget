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
import { BANK_LINKING_ENABLED } from '../../lib/feature-flags';
import { confirmAction, notify } from '../../lib/confirm';
import { formatMonthLabel, currencySymbol } from '../../lib/format';
import { useHouseholdStatus, sharingSummary } from '../../lib/useHouseholdStatus';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR'];

const GRACE_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
];

/**
 * Turns the parser's skip reasons into something a person can act on.
 *
 * The point is the quoted line: when an import fails, the one thing that makes
 * it fixable is seeing what the app actually read. Section headers are excluded
 * from the count because skipping those is correct behaviour, not a failure —
 * counting them made a working import look broken.
 */
function describeWhyNothingImported(skipped: { reason: string; raw: string }[]): string {
  const real = skipped.filter((s) => s.reason !== 'section-total');
  if (real.length === 0) {
    return 'That file only had headings and totals in it — no transaction rows to import.';
  }
  const counts = real.reduce<Record<string, number>>((acc, s) => {
    acc[s.reason] = (acc[s.reason] ?? 0) + 1;
    return acc;
  }, {});
  const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const example = real.find((s) => s.reason === worst)?.raw.trim().slice(0, 90);

  const why =
    worst === 'no-date'
      ? `Couldn't read a date on any of the ${real.length} rows.`
      : worst === 'no-amount'
        ? `Couldn't find an amount on any of the ${real.length} rows.`
        : `Every one of the ${real.length} rows had an amount of zero.`;

  return example
    ? `${why}\n\nThis is what one row looked like:\n"${example}"\n\nIf that looks wrong, a CSV export from your bank will import cleanly.`
    : `${why} A CSV export from your bank will import cleanly.`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings, categories, cards, selectedMonth, updateSettings, refresh } = useBudget();
  const { isConfigured: cloudConfigured, user } = useAuth();
  const sharing = useHouseholdStatus();
  const [busy, setBusy] = useState(false);
  const [biometricType, setBiometricType] = useState<string | null>(null);
  const [pickingCardFor, setPickingCardFor] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  // iOS drops a presentation that begins while another sheet is still
  // dismissing, so the file picker never appeared. Hold the chosen card until
  // the sheet has fully gone away (Modal.onDismiss), then present the picker.
  const [pendingImportCardId, setPendingImportCardId] = useState<string | null>(null);

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
        notify('Import complete', `Imported ${result.imported} transactions, skipped ${result.skipped}.`);
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
      if (!ok) notify('Backup unavailable', 'Sharing is not available on this device.');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    const ok = await confirmAction({
      title: 'Restore from backup?',
      message: 'This replaces ALL current data in the app with the contents of the backup file. This cannot be undone.',
      confirmLabel: 'Choose file & restore',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await importDatabaseFromJson();
      notify(result.success ? 'Restore complete' : 'Restore failed', result.message);
      if (result.success) await refresh();
    } finally {
      setBusy(false);
    }
  };

  // Chosen a card in the picker sheet. On iOS the actual import waits for the
  // sheet's dismiss animation to finish (see pendingImportCardId); other
  // platforms can present immediately.
  const onPickCardForImport = (cardId: string) => {
    setPickingCardFor(false);
    if (Platform.OS === 'ios') setPendingImportCardId(cardId);
    else doImportStatement(cardId);
  };

  const doImportStatement = async (cardId: string) => {
    setBusy(true);
    try {
      const result = await pickAndParseStatement();
      if (result === null) return; // user cancelled the file picker
      if ('pdfUnsupported' in result) {
        notify('PDF import unavailable', result.reason);
        return;
      }
      if ('unrecognizedFormat' in result) {
        notify(
          'Nothing to import',
          result.diagnostic ??
            "Couldn't find date, description, and amount columns in that file. Export it as a CSV with those columns and try again."
        );
        return;
      }
      if (result.rows.length === 0) {
        // Say WHICH check failed and show a line that failed it. The old text
        // ("nothing matched a date + amount") named both possible causes at
        // once and quoted nothing, so a statement that imported zero rows gave
        // no clue whether the dates or the amounts were the problem — and no
        // way to tell us either.
        notify('Nothing to import', describeWhyNothingImported(result.skipped));
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
        notify('Import complete', notes.join('\n'));
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

        {/* Budget, Cards and Insights moved out of the tab bar; this hub is
            their new front door, so it sits above every other section. */}
        <View style={styles.hubRow}>
          <HubCard icon="pie-chart" label="Budget" onPress={() => router.push('/(tabs)/budget')} />
          <HubCard icon="card" label="Cards" onPress={() => router.push('/(tabs)/cards')} />
          <HubCard icon="bar-chart" label="Insights" onPress={() => router.push('/(tabs)/insights')} />
        </View>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Account</Text>
          <SettingsLink
            label={cloudConfigured && user ? `Signed in as ${user.email}` : 'Sign In / Create Account'}
            onPress={() => router.push('/account')}
          />
          {cloudConfigured && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.separator }]} />
              {/* One row, not a switch. Syncing your own devices and sharing with
                  another person are the same mechanism, and a switch here that
                  quietly created a second household is what split one couple's
                  budget across five of them. The linked screen owns every
                  change and always names who is in it. */}
              <SettingsLink
                label="Sharing"
                detail={sharingSummary(sharing, !!user)}
                onPress={() => router.push('/household')}
              />
            </>
          )}
          {cloudConfigured && BANK_LINKING_ENABLED && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.separator }]} />
              <SettingsLink label="Linked Banks" onPress={() => router.push('/bank')} />
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
          {/* Bills is the calendar VIEW of what Recurring Bills defines, so it
              sits directly under it rather than in its own section. */}
          <SettingsLink
            label="Bill Calendar"
            detail="Due dates this month, and reminders"
            onPress={() => router.push('/bills')}
          />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink label="Funds" onPress={() => router.push('/funds')} />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink
            label="Net Worth"
            detail="What you own and owe, entered by you"
            onPress={() => router.push('/net-worth')}
          />
          <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          <SettingsLink
            label="Planner"
            detail="When goals finish, and the fastest way out of debt"
            onPress={() => router.push('/planner')}
          />
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
          {/* The monthly PDF report used to sit at the top of this section,
              which read as a technical file operation sandwiched between CSV
              export and CSV import — "Export August 2026 report" next to
              "Export CSV" looks like two flavours of the same thing. It is
              actually the shareable summary of the month, so it now lives on
              Insights, where the month's story already is. What is left here is
              genuine data portability. */}
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
            onPress={() => (cards.length > 0 ? setPickingCardFor(true) : notify('Add a card first'))}
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

        {/* The old iCloud Sync section lived here: a permanently-disabled switch
            labelled "Coming in a future update". Shipping non-functional UI is an
            App Review 2.2 risk, and it was redundant — the working "Sync across my
            devices" toggle above does this via the optional account. */}

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

        {/* Currency lives LAST, as a picker row: it's set once at onboarding and
            essentially never again, so a permanently open chip row at the top
            was prime real estate spent on a decision nobody revisits — and it
            made the screen open with something that looks editable by accident. */}
        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>Preferences</Text>
          <Pressable
            style={styles.actionRow}
            onPress={() => setPickingCurrency(true)}
            accessibilityRole="button"
            accessibilityLabel={`Currency, currently ${settings.currency}`}
          >
            <Text style={{ color: theme.label, fontSize: 15, flex: 1 }}>Currency</Text>
            <Text style={{ color: theme.secondaryLabel, fontSize: 15, marginRight: 6 }}>{settings.currency}</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.tertiaryLabel} />
          </Pressable>
        </Surface>

        <Surface>
          <Text style={[styles.sectionTitle, { color: theme.label }]}>About</Text>
          <SettingsLink label="What's New" onPress={() => router.push('/whats-new')} />
        </Surface>

        <Text style={[styles.footer, { color: theme.tertiaryLabel }]}>
          Penny Budget — your data stays on this device unless you turn on an optional account and back it up.
        </Text>
      </ScrollView>

      <Modal
        visible={pickingCardFor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickingCardFor(false)}
        onDismiss={() => {
          // iOS only — fires after the sheet is fully gone, so presenting the
          // document picker here actually works.
          if (!pendingImportCardId) return;
          const cardId = pendingImportCardId;
          setPendingImportCardId(null);
          doImportStatement(cardId);
        }}
      >
        <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
          <Text style={[type.title2, { color: theme.label, marginBottom: spacing.lg }]}>Which card is this statement for?</Text>
          <ScrollView>
            {cards.map((c) => (
              <Pressable key={c.id} style={styles.pickerRow} onPress={() => onPickCardForImport(c.id)}>
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

      <Modal
        visible={pickingCurrency}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickingCurrency(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: theme.groupedBackground }]}>
          <Text style={[type.title2, { color: theme.label, marginBottom: spacing.sm }]}>Currency</Text>
          <Text style={[styles.hint, { color: theme.tertiaryLabel, marginBottom: spacing.md }]}>
            Changes only the display symbol — does not convert historical amounts.
          </Text>
          <ScrollView>
            {CURRENCIES.map((cur) => {
              const active = settings.currency === cur;
              return (
                <Pressable
                  key={cur}
                  style={styles.pickerRow}
                  onPress={async () => {
                    await updateSettings({ currency: cur });
                    setPickingCurrency(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: theme.label, fontSize: 16, flex: 1 }}>
                    {currencySymbol(cur)}  {cur}
                  </Text>
                  {active && <Ionicons name="checkmark" size={20} color={theme.accent} />}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={[styles.modalCancel, { borderColor: theme.separator }]} onPress={() => setPickingCurrency(false)}>
            <Text style={{ color: theme.label, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function HubCard({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      style={[styles.hubCard, { backgroundColor: theme.accentTint }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={26} color={theme.accent} />
      <Text style={{ color: theme.label, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function SettingsLink({ label, detail, onPress }: { label: string; detail?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable style={styles.actionRow} onPress={onPress} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.label, fontSize: 15 }}>{label}</Text>
        {detail ? <Text style={{ color: theme.tertiaryLabel, fontSize: 12, marginTop: 2 }}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.tertiaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  hubRow: { flexDirection: 'row', gap: spacing.md },
  hubCard: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: spacing.lg, borderRadius: radius.lg },
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

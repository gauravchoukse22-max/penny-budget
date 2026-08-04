import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Button } from './Button';
import { confirmAction, notify } from '../lib/confirm';
import { useTheme, spacing, radius } from '../theme/colors';
import {
  attachReceipt,
  detachReceipt,
  getReceiptUri,
  hasReceiptFile,
  pickReceiptAsset,
  resolveReceiptUri,
} from '../features/receipts';

/**
 * Attach, view and remove a transaction's receipt.
 *
 * ── Three states, and the third is the one that matters ────────────────────
 *   1. No receipt        → offer to attach one.
 *   2. Receipt, file here → show it, offer to open or remove it.
 *   3. Receipt recorded, file NOT here → say so, explicitly.
 *
 * State 3 is real and common, not defensive coding. The `receiptUri` column
 * syncs with the transaction but the FILE does not, so the household's other
 * phone legitimately knows a receipt exists without having the bytes; the same
 * happens after restoring a backup, which carries the column and (deliberately)
 * not the photos — see features/receipts.ts for why inlining them would make
 * the backup fail on the devices that need it most. Rendering nothing in that
 * state would read as "the photo was lost", which is both alarming and wrong.
 *
 * The device-only caveat is stated on screen whenever a receipt is attached
 * rather than buried in a settings page. A user who believes their receipts are
 * backed up and finds out otherwise after losing a phone has been actively
 * misled by the UI, and this is the only place that can prevent it.
 */
export function ReceiptField({
  transactionId,
  onChanged,
}: {
  transactionId: string;
  /** Fired after attach/remove so the parent can re-read the transaction. */
  onChanged?: () => void;
}) {
  const theme = useTheme();
  const [stored, setStored] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const uri = await getReceiptUri(transactionId);
    setStored(uri);
    setPresent(await hasReceiptFile(uri));
    setLoaded(true);
  }, [transactionId]);

  useEffect(() => {
    load();
  }, [load]);

  const attach = async () => {
    setBusy(true);
    try {
      const picked = await pickReceiptAsset();
      if (!picked) return;
      const relative = await attachReceipt(transactionId, picked);
      if (!relative) {
        notify('Could not attach', 'This device has no writable storage for receipts.');
        return;
      }
      await load();
      onChanged?.();
    } catch (error) {
      // Surfaced rather than swallowed: a silent no-op here looks identical to
      // cancelling the picker, so the user retries forever without learning
      // that anything failed.
      console.error('Failed to attach receipt:', error);
      notify('Could not attach', 'That file could not be copied. Try a different one.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = await confirmAction({
      title: 'Remove receipt?',
      message: 'The image is deleted from this device. This cannot be undone.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await detachReceipt(transactionId);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const uri = resolveReceiptUri(stored);
    if (!uri) return;
    // The share sheet doubles as the viewer — iOS previews an image or PDF in
    // Quick Look from here. A dedicated full-screen viewer was not worth a new
    // screen for something the OS already does better, and this also gives the
    // user a way to send the receipt on, which is half of why people keep them.
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  };

  if (!loaded) return null;

  const isImage = !!stored && !stored.toLowerCase().endsWith('.pdf') && !stored.toLowerCase().endsWith('.bin');
  const resolved = resolveReceiptUri(stored);

  return (
    <View style={[styles.field, { backgroundColor: theme.card }]}>
      {!stored && (
        <>
          <Button
            label="Attach receipt"
            icon="document-attach-outline"
            variant="glass"
            size="sm"
            loading={busy}
            onPress={attach}
            style={{ alignSelf: 'flex-start' }}
          />
          <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
            Receipts are stored on this device only. They are not included in backups and are not shared with your
            household.
          </Text>
        </>
      )}

      {stored && present && (
        <>
          <View style={styles.preview}>
            {isImage && resolved ? (
              <Image
                source={{ uri: resolved }}
                style={[styles.thumb, { borderColor: theme.separator }]}
                resizeMode="cover"
                accessible
                accessibilityLabel="Receipt image"
              />
            ) : (
              <View style={[styles.thumb, styles.fileThumb, { backgroundColor: theme.fieldBackground, borderColor: theme.separator }]}>
                <Ionicons name="document-text-outline" size={26} color={theme.secondaryLabel} />
              </View>
            )}
            <View style={styles.previewText}>
              <Text style={{ color: theme.label, fontWeight: '600', fontSize: 14 }}>Receipt attached</Text>
              <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
                On this device only — not in backups.
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Button label="Open" icon="open-outline" variant="tonal" size="sm" onPress={open} />
            <Button label="Replace" variant="glass" size="sm" loading={busy} onPress={attach} />
            <Button label="Remove" variant="ghost" size="sm" loading={busy} onPress={remove} />
          </View>
        </>
      )}

      {stored && !present && (
        <>
          <View style={styles.preview}>
            <View style={[styles.thumb, styles.fileThumb, { backgroundColor: theme.fieldBackground, borderColor: theme.separator }]}>
              <Ionicons name="cloud-offline-outline" size={26} color={theme.tertiaryLabel} />
            </View>
            <View style={styles.previewText}>
              <Text style={{ color: theme.label, fontWeight: '600', fontSize: 14 }}>Receipt is on another device</Text>
              <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
                This transaction has a receipt, but the image itself isn't on this phone. Receipt files aren't synced or
                backed up — only the record that one exists.
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Button label="Attach one here" variant="glass" size="sm" loading={busy} onPress={attach} />
            <Button label="Clear" variant="ghost" size="sm" loading={busy} onPress={remove} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  fileThumb: { alignItems: 'center', justifyContent: 'center' },
  previewText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  help: { fontSize: 12, lineHeight: 16 },
});

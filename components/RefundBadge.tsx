import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { confirmAction } from '../lib/confirm';
import { formatCurrency, currencySymbol } from '../lib/format';
import { parseMoneyInput } from '../lib/parse-number';
import { useTheme, spacing, radius, tint } from '../theme/colors';
import {
  clearRefundClaim,
  getRefundClaim,
  markRefundReceived,
  setRefundClaim,
  type RefundClaim,
} from '../features/refunds';

// The refund tracker's two surfaces, in one file so the badge and the editor
// cannot drift into describing the same claim differently.
//
//   • RefundBadge — read-only, for a transaction row.
//   • RefundField — the editor on the transaction detail screen.
//
// ── The naming trap ─────────────────────────────────────────────────────────
// The transaction screens ALREADY have a "Refund / credit" toggle, and it means
// something else: money that has come back, entered as a negative amount. This
// is the opposite state — money that has NOT come back yet. Every string here
// says "awaiting" or "expected back" rather than just "refund", because two
// controls a few hundred points apart both labelled "refund" that do different
// things is a UI that teaches the user the wrong thing on first use.

// ── RefundBadge ─────────────────────────────────────────────────────────────

/**
 * "Awaiting $60" on a transaction row.
 *
 * Amber rather than red: the money is not a problem, it is outstanding. Red is
 * what this app uses for over budget, and reusing it here would make a normal
 * pending reimbursement read as something gone wrong.
 *
 * Renders nothing once the claim is received — the row should go back to
 * looking ordinary rather than keeping a permanent marker.
 */
export function RefundBadge({ claim, currency }: { claim: RefundClaim | undefined; currency: string }) {
  const theme = useTheme();
  if (!claim || claim.status !== 'awaiting') return null;
  return (
    <View style={[styles.badge, { backgroundColor: tint(theme.systemAmber, 0.16), borderColor: tint(theme.systemAmber, 0.45) }]}>
      <Ionicons name="hourglass-outline" size={11} color={theme.systemAmber} />
      <Text style={{ color: theme.systemAmber, fontSize: 11, fontWeight: '700' }}>
        {formatCurrency(claim.expectedAmount, currency)} back
      </Text>
    </View>
  );
}

// ── RefundField ─────────────────────────────────────────────────────────────

export interface RefundFieldProps {
  transactionId: string;
  /** The transaction's own amount, used as the default expected amount. */
  transactionAmount: number;
  currency: string;
  /** Fired after any write, so the screen can refresh totals elsewhere. */
  onChanged?: () => void;
}

/**
 * Mark a transaction as awaiting a refund, and track how much.
 *
 * The expected amount defaults to the transaction's full amount and is
 * editable, because partial refunds are the normal case — one item returned
 * from a five-item order. Defaulting to the full amount keeps the common case
 * one tap; making it editable is what stops the outstanding total being wrong
 * for everybody else.
 */
export function RefundField({ transactionId, transactionAmount, currency, onChanged }: RefundFieldProps) {
  const theme = useTheme();
  const [claim, setClaim] = useState<RefundClaim | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const found = await getRefundClaim(transactionId);
    setClaim(found);
    setExpected(found ? String(found.expectedAmount) : String(Math.abs(transactionAmount)));
    setLoaded(true);
  }, [transactionId, transactionAmount]);

  useEffect(() => {
    load();
  }, [load]);

  const parsed = parseMoneyInput(expected);
  const canSave = parsed !== null && parsed > 0;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  // Held back until the claim has loaded, so the control cannot flash "not
  // awaiting" on a transaction that IS awaiting and invite a stray tap that
  // overwrites a real claim.
  if (!loaded) return null;

  const awaiting = claim?.status === 'awaiting';
  const received = claim?.status === 'received';

  return (
    <View style={[styles.field, { backgroundColor: theme.card }]}>
      {!claim && (
        <>
          <Button
            label="I'm expecting this back"
            icon="hourglass-outline"
            variant="glass"
            size="sm"
            loading={busy}
            onPress={() => run(() => setRefundClaim(transactionId, { expectedAmount: Math.abs(transactionAmount) }))}
            style={{ alignSelf: 'flex-start' }}
          />
          <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
            For a return, a work expense or a duplicate charge. It stays in your outstanding total until you mark it
            received.
          </Text>
        </>
      )}

      {awaiting && (
        <>
          <View style={styles.row}>
            <Ionicons name="hourglass-outline" size={16} color={theme.systemAmber} />
            <Text style={{ color: theme.systemAmber, fontWeight: '700', fontSize: 14, flex: 1 }}>Awaiting refund</Text>
          </View>

          <Text style={[styles.label, { color: theme.secondaryLabel }]}>Expected back</Text>
          <View style={styles.amountRow}>
            <Text style={{ color: theme.secondaryLabel, fontSize: 17 }}>{currencySymbol(currency)}</Text>
            <TextInput
              style={[styles.amountInput, { backgroundColor: theme.fieldBackground, color: theme.label }]}
              keyboardType="numeric"
              value={expected}
              onChangeText={setExpected}
              accessibilityLabel="Amount expected back"
            />
            <Button
              label="Update"
              variant="tonal"
              size="sm"
              disabled={!canSave || parsed === claim.expectedAmount}
              loading={busy}
              onPress={() => canSave && run(() => setRefundClaim(transactionId, { expectedAmount: parsed }))}
            />
          </View>
          {/* Only shown when it differs, so the common full-amount case stays
              quiet and the partial case is unmissable. */}
          {canSave && Math.round(parsed * 100) !== Math.round(Math.abs(transactionAmount) * 100) && (
            <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
              Partial refund of a {formatCurrency(Math.abs(transactionAmount), currency)} charge.
            </Text>
          )}

          <View style={styles.actions}>
            <Button
              label="Mark received"
              icon="checkmark-circle-outline"
              variant="tonal"
              size="sm"
              loading={busy}
              onPress={() => run(() => markRefundReceived(transactionId))}
            />
            <Button
              label="Not expecting it"
              variant="ghost"
              size="sm"
              loading={busy}
              onPress={async () => {
                const confirmed = await confirmAction({
                  title: 'Stop tracking this refund?',
                  message: 'It will be removed from your outstanding total.',
                  confirmLabel: 'Stop tracking',
                  destructive: true,
                });
                if (confirmed) await run(() => clearRefundClaim(transactionId));
              }}
            />
          </View>
          {/* The honest part: marking it received does NOT create the credit.
              Saying so is what stops the user expecting their balance to move. */}
          <Text style={[styles.help, { color: theme.tertiaryLabel }]}>
            When it lands, mark it received and add the credit as its own transaction — KaiJar won't invent one your bank
            hasn't confirmed.
          </Text>
        </>
      )}

      {received && (
        <>
          <View style={styles.row}>
            <Ionicons name="checkmark-circle" size={16} color={theme.systemGreen} />
            <Text style={{ color: theme.systemGreen, fontWeight: '700', fontSize: 14, flex: 1 }}>
              Refund received{claim.resolvedAt ? ` · ${formatCurrency(claim.expectedAmount, currency)}` : ''}
            </Text>
          </View>
          <View style={styles.actions}>
            <Button
              label="Still waiting"
              variant="glass"
              size="sm"
              loading={busy}
              onPress={() => run(() => setRefundClaim(transactionId, { expectedAmount: claim.expectedAmount }))}
            />
            <Button
              label="Remove"
              variant="ghost"
              size="sm"
              loading={busy}
              onPress={() => run(() => clearRefundClaim(transactionId))}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  field: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountInput: { flex: 1, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, fontSize: 15 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  help: { fontSize: 12, lineHeight: 16 },
});

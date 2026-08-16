import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius } from '../theme/colors';
import { Chip } from './Button';
import { AmountText } from './AmountText';
import {
  cellKey,
  loadFundGrid,
  transactionFundEntryId,
  type TransactionFundTarget,
} from '../features/funds';
import type { Fund, FundAccount } from '../features/models';

// ---------------------------------------------------------------------------
// "This came out of a fund we'd already saved."
//
// Booking the holiday you saved for is TWO facts: a charge on a card, and money
// leaving the Vacation fund. The app used to make you record the second one by
// hand on a different screen, which is the step people skip — after which the
// fund reads high forever and nothing on screen explains why.
//
// Picking the fund here is what links them. features/funds.ts files the
// withdrawal; this control's only jobs are choosing the cell and showing what
// the fund will be left with, BEFORE saving, because the balance is the thing
// the user is actually deciding against.
// ---------------------------------------------------------------------------

type Props = {
  value: TransactionFundTarget;
  onChange: (next: TransactionFundTarget) => void;
  /** The pending charge, SIGNED as the transaction stores it — expense
   * positive, refund negative. Only used for the preview line. */
  amount: number;
  currency: string;
  /**
   * The transaction being edited, if any.
   *
   * Its withdrawal is ALREADY in the ledger, so the cell's stored balance has
   * it deducted. Without this, editing a $500 holiday charge would preview the
   * fund dropping by another $500 — the number on screen would be wrong by the
   * amount of the very transaction being looked at.
   */
  transactionId?: string;
  /** Bumped by the parent to force a reload after the ledger changes. */
  reloadKey?: number;
};

export function FundPaymentField({ value, onChange, amount, currency, transactionId, reloadKey }: Props) {
  const theme = useTheme();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [accounts, setAccounts] = useState<FundAccount[]>([]);
  const [cells, setCells] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { funds: fundRows, accounts: accountRows, entries, grid } = await loadFundGrid();
    // Balances with this transaction's own withdrawal taken back OUT, so the
    // preview below always answers "what would this cell hold if this charge
    // were filed right now" — the same question whether adding or editing.
    const ownEntryId = transactionId ? transactionFundEntryId(transactionId) : null;
    const own = ownEntryId ? entries.find((e) => e.id === ownEntryId) : undefined;
    const baseline = new Map(grid.cells);
    if (own) {
      const key = cellKey(own.fundId, own.accountId);
      baseline.set(key, (baseline.get(key) ?? 0) - own.amount);
    }
    setFunds(fundRows);
    setAccounts(accountRows);
    setCells(baseline);
    setLoaded(true);
  }, [transactionId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const balanceOf = useCallback(
    (fundId: string, accountId: string) => cells.get(cellKey(fundId, accountId)) ?? 0,
    [cells]
  );

  /** Where a fund's money actually sits — the account holding the most of it.
   * Picking the fund is the decision; which column it came out of usually
   * isn't, so it should already be answered. */
  const defaultAccountFor = useCallback(
    (fundId: string): string | null => {
      if (accounts.length === 0) return null;
      let best = accounts[0];
      let bestBalance = balanceOf(fundId, best.id);
      for (const account of accounts.slice(1)) {
        const balance = balanceOf(fundId, account.id);
        if (balance > bestBalance) {
          best = account;
          bestBalance = balance;
        }
      }
      return best.id;
    },
    [accounts, balanceOf]
  );

  const selectedFund = value ? funds.find((f) => f.id === value.fundId) ?? null : null;
  const selectedAccount = value ? accounts.find((a) => a.id === value.accountId) ?? null : null;

  // A fund deleted here or on the other phone leaves an edited transaction
  // pointing at nothing: no chip would look selected, yet saving would file the
  // withdrawal into a row that no longer exists, where no total counts it and
  // the user can never find it. Drop the link instead, visibly.
  useEffect(() => {
    if (!loaded || !value) return;
    if (!selectedFund || !selectedAccount) onChange(null);
  }, [loaded, value, selectedFund, selectedAccount, onChange]);

  const preview = useMemo(() => {
    if (!value || !selectedFund || !selectedAccount) return null;
    const before = balanceOf(value.fundId, value.accountId);
    const after = before - amount;
    return { before, after, short: after < 0 && before >= 0 };
  }, [value, selectedFund, selectedAccount, balanceOf, amount]);

  // Nothing to pick from, so nothing to show. The grid starts empty by design,
  // and a dead row prompting for funds that don't exist is worse than silence
  // on a screen whose whole shape is "type a number and save".
  if (!loaded || funds.length === 0 || accounts.length === 0) return null;

  return (
    <>
      <Text style={[styles.label, { color: theme.secondaryLabel }]}>Paid from a fund</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip
          label="No"
          size="sm"
          selected={value === null}
          onPress={() => onChange(null)}
        />
        {funds.map((fund) => (
          <Chip
            key={fund.id}
            label={fund.name}
            size="sm"
            icon="wallet-outline"
            selected={value?.fundId === fund.id}
            onPress={() => {
              if (value?.fundId === fund.id) {
                onChange(null);
                return;
              }
              const accountId = defaultAccountFor(fund.id);
              onChange(accountId ? { fundId: fund.id, accountId } : null);
            }}
          />
        ))}
      </ScrollView>

      {/* Only once a fund is chosen, and only where the column is a real
          choice — one account means there is nothing to decide. */}
      {value && accounts.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, styles.accountRow]}>
          {accounts.map((account) => (
            <Chip
              key={account.id}
              label={account.name}
              size="sm"
              selected={value.accountId === account.id}
              onPress={() => onChange({ fundId: value.fundId, accountId: account.id })}
            />
          ))}
        </ScrollView>
      )}

      {preview && (
        <View style={[styles.preview, { backgroundColor: theme.fieldBackground }]}>
          <Ionicons
            name={preview.short ? 'alert-circle' : 'arrow-down-circle-outline'}
            size={15}
            color={preview.short ? theme.systemAmber : theme.secondaryLabel}
          />
          <Text style={{ color: theme.secondaryLabel, fontSize: 13, flexShrink: 1 }}>
            {selectedFund?.name}
            {accounts.length > 1 ? ` · ${selectedAccount?.name}` : ''} goes to{' '}
          </Text>
          <AmountText
            amount={preview.after}
            currency={currency}
            size={13}
            weight="semibold"
            color={preview.short ? theme.systemAmber : theme.label}
          />
          {/* Said, not blocked. The fund reading low may be exactly the fact the
              user wants recorded — they know they overspent, and refusing to
              save it would just push them back to keeping it in their head. */}
          {preview.short && (
            <Text style={{ color: theme.systemAmber, fontSize: 13 }}> — more than it holds</Text>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.sm },
  accountRow: { marginTop: spacing.sm },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
});

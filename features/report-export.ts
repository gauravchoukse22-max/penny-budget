import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { formatCurrency, formatMonthLabel, formatShortDate } from '../lib/format';
import { downloadOrShareFile } from '../lib/files';
import { notify } from '../lib/confirm';
import {
  computeCardTotalsFrom,
  computeCategorySummariesFrom,
  computeSurplusFrom,
  getAppSettings,
  listCards,
  listCategories,
  listSavingsGoals,
  listTransactionsForMonth,
  listTransferStatus,
  resolveCategoryLimits,
  resolveSalaryForMonth,
  resolveSavingsGoalAmounts,
} from '../lib/queries';
import type { Card, CategorySpendSummary, Transaction } from '../lib/models';

// Monthly report PDF export — the "one page you'd show your partner" summary.
// MoneyCoach sells this as a premium feature; here it's free. The HTML builder
// is pure (no db, no native modules) so scripts/test-report-html.mjs can run it
// under plain Node against fabricated months.
//
// Deliberately ignores the "Hide amounts" setting: an export is the user
// explicitly producing their own data to keep or share, not an on-screen
// glance a shoulder-surfer could catch.

export type MonthlyReportData = {
  currency: string;
  summary: { salary: number; spend: number; savings: number; surplus: number };
  categories: CategorySpendSummary[];
  cards: Card[];
  cardTotals: Map<string, number>;
  transactions: Transaction[];
  /** Injectable so the fixture test renders a stable footer. Defaults to now. */
  generatedAt?: Date;
};

/** Minimal HTML escape — category names and notes are user-typed free text. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the one-page monthly report as a self-contained HTML string (inline
 * CSS only — expo-print renders it in an offscreen WebView with no network).
 * Pure on purpose: everything it needs arrives in `data`.
 */
export function generateMonthlyReportHtml(yearMonth: string, data: MonthlyReportData): string {
  const { currency, summary, categories, cards, cardTotals, transactions } = data;
  const money = (amount: number) => formatCurrency(amount, currency);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const categoryNameById = new Map(categories.map((s) => [s.category.id, s.category.name]));

  // Only categories that carried a budget or saw spend this month — a report
  // row that is 0 / 0 / 0 says nothing and costs page height.
  const categoryRows = categories
    .filter((s) => s.category.monthlyLimit > 0 || s.spend > 0)
    .map((s) => {
      const hasLimit = s.category.monthlyLimit > 0;
      const over = hasLimit && s.remaining < 0;
      // A category with no limit has no meaningful "remaining" — show a dash
      // instead of a negative number that looks like an overspend.
      const remainingCell = hasLimit
        ? `<td class="num ${over ? 'over' : 'under'}">${over ? `${money(Math.abs(s.remaining))} over` : `${money(s.remaining)} left`}</td>`
        : '<td class="num muted">&mdash;</td>';
      return `<tr>
        <td>${esc(s.category.name)}</td>
        <td class="num">${hasLimit ? money(s.category.monthlyLimit) : '&mdash;'}</td>
        <td class="num">${money(s.spend)}</td>
        ${remainingCell}
      </tr>`;
    })
    .join('\n');

  // Card totals in the app's card order, skipping cards with nothing this month.
  const cardRows = cards
    .filter((c) => (cardTotals.get(c.id) ?? 0) !== 0)
    .map(
      (c) => `<tr>
        <td>${esc(c.name)}${c.lastFour ? ` <span class="muted">&bull;&bull;${esc(c.lastFour)}</span>` : ''}</td>
        <td class="num">${money(cardTotals.get(c.id) ?? 0)}</td>
      </tr>`
    )
    .join('\n');

  const topTransactions = [...transactions]
    .filter((t) => t.amount > 0) // refunds/credits aren't "largest spends"
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map(
      (t) => `<tr>
        <td class="muted">${esc(formatShortDate(t.date))}</td>
        <td>${esc(t.note ?? '') || '<span class="muted">(no note)</span>'}</td>
        <td>${esc((t.categoryId ? categoryNameById.get(t.categoryId) : null) ?? 'Uncategorized')}</td>
        <td>${esc(cardById.get(t.cardId)?.name ?? 'Unknown card')}</td>
        <td class="num">${money(t.amount)}</td>
      </tr>`
    )
    .join('\n');

  const emptyRow = (cols: number, text: string) =>
    `<tr><td colspan="${cols}" class="muted empty">${text}</td></tr>`;

  const generatedOn = (data.generatedAt ?? new Date()).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Roboto, sans-serif; color: #1c1c1e; margin: 28px 32px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .subtitle { color: #8e8e93; margin: 0 0 18px; font-size: 12px; }
  .summary { display: flex; gap: 10px; margin-bottom: 20px; }
  .stat { flex: 1; border: 1px solid #e5e5ea; border-radius: 10px; padding: 10px 12px; }
  .stat .label { color: #8e8e93; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .value { font-size: 16px; font-weight: 700; margin-top: 3px; }
  .stat .value.negative { color: #d70015; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; color: #636366; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 6px; border-bottom: 1px solid #d1d1d6; }
  td { padding: 5px 6px; border-bottom: 1px solid #f2f2f7; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .over { color: #d70015; font-weight: 600; }
  .under { color: #248a3d; }
  .muted { color: #8e8e93; }
  .empty { text-align: center; padding: 12px 6px; }
  .footer { margin-top: 24px; color: #aeaeb2; font-size: 10px; text-align: center; }
</style>
</head>
<body>
  <h1>${esc(formatMonthLabel(yearMonth))}</h1>
  <p class="subtitle">Monthly budget report</p>

  <div class="summary">
    <div class="stat"><div class="label">Income</div><div class="value">${money(summary.salary)}</div></div>
    <div class="stat"><div class="label">Spent</div><div class="value">${money(summary.spend)}</div></div>
    <div class="stat"><div class="label">Saved</div><div class="value">${money(summary.savings)}</div></div>
    <div class="stat"><div class="label">Left over</div><div class="value${summary.surplus < 0 ? ' negative' : ''}">${money(summary.surplus)}</div></div>
  </div>

  <h2>Categories</h2>
  <table>
    <thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Remaining</th></tr></thead>
    <tbody>${categoryRows || emptyRow(4, 'No category activity this month.')}</tbody>
  </table>

  <h2>Spending by card</h2>
  <table>
    <thead><tr><th>Card</th><th class="num">Total</th></tr></thead>
    <tbody>${cardRows || emptyRow(2, 'No card activity this month.')}</tbody>
  </table>

  <h2>Largest transactions</h2>
  <table>
    <thead><tr><th>Date</th><th>Note</th><th>Category</th><th>Card</th><th class="num">Amount</th></tr></thead>
    <tbody>${topTransactions || emptyRow(5, 'No transactions this month.')}</tbody>
  </table>

  <div class="footer">Generated by Penny Budget &middot; ${esc(generatedOn)}</div>
</body>
</html>`;
}

/** Gathers a month's data through the same queries the screens use. */
async function loadMonthlyReportData(yearMonth: string): Promise<MonthlyReportData> {
  // One transaction read feeds surplus, categories AND card totals — same
  // reuse of the pure *From helpers the context refresh relies on.
  const [settings, salary, transactions, categories, limits, cards, goals, transferStatus, goalAmounts] =
    await Promise.all([
      getAppSettings(),
      resolveSalaryForMonth(yearMonth),
      listTransactionsForMonth(yearMonth),
      listCategories(),
      resolveCategoryLimits(yearMonth),
      listCards(),
      listSavingsGoals(),
      listTransferStatus(yearMonth),
      resolveSavingsGoalAmounts(yearMonth),
    ]);
  return {
    currency: settings.currency,
    summary: computeSurplusFrom(salary, transactions, goals, transferStatus, goalAmounts),
    categories: computeCategorySummariesFrom(categories, transactions, limits),
    cards,
    cardTotals: computeCardTotalsFrom(transactions),
    transactions,
  };
}

/**
 * Renders the month's report to a PDF and hands it to the share sheet.
 *
 * expo-print was added as a JS dependency before its native module has been
 * compiled into a build — until the next TestFlight/Play build, calling into
 * it throws. Everything below is wrapped so an unlinked module produces a
 * friendly "after the next update" notice instead of a red-screen crash.
 */
/**
 * Copy a generated temp file next to itself under a human-readable name, and
 * return the new uri. Purely cosmetic — if anything about the copy fails we
 * hand back the original uri so the export still happens, just ugly-named.
 */
async function renameForSharing(uri: string, filename: string): Promise<string> {
  try {
    const FileSystem = require('expo-file-system/legacy');
    const dir = FileSystem.cacheDirectory;
    if (!dir) return uri;
    // Slashes and colons would break the path (and Files' display name).
    const safe = filename.replace(/[/\\:]/g, '-');
    const target = dir + encodeURIComponent(safe);
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.copyAsync({ from: uri, to: target });
    return target;
  } catch {
    return uri;
  }
}

export async function exportMonthlyReportPdf(yearMonth: string): Promise<void> {
  const html = generateMonthlyReportHtml(yearMonth, await loadMonthlyReportData(yearMonth));

  if (Platform.OS === 'web') {
    // No printToFileAsync on web — deliver the same report as a self-contained
    // HTML file, which the browser can print to PDF itself.
    await downloadOrShareFile(html, `penny-budget-report-${yearMonth}.html`, 'text/html', 'Monthly Report');
    return;
  }

  let printToFileAsync: (options: { html: string }) => Promise<{ uri: string }>;
  try {
    // Lazy require, not a top-level import: if the native module isn't in this
    // binary yet, the throw happens HERE inside the try instead of taking down
    // whichever screen imported this file.
    printToFileAsync = require('expo-print').printToFileAsync;
    if (typeof printToFileAsync !== 'function') throw new Error('expo-print unavailable');
  } catch {
    notify('PDF export isn’t ready yet', 'It becomes available after the next app update.');
    return;
  }

  try {
    const { uri } = await printToFileAsync({ html });
    // printToFileAsync names the file with a bare UUID, which is what the share
    // sheet shows and what "Save to Files" writes to disk. Rename it to
    // something a person can find later ("Penny Budget - August 2026.pdf").
    const shareUri = await renameForSharing(uri, `Penny Budget - ${formatMonthLabel(yearMonth)}.pdf`);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(shareUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Monthly Report',
        UTI: 'com.adobe.pdf',
      });
    } else {
      notify('Sharing unavailable', 'Sharing is not available on this device.');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The unlinked-native-module failure surfaces at call time on some SDK
    // versions rather than at require time — give it the same friendly notice.
    if (/native module|ExponentPrint|NativeModule|could not be found/i.test(message)) {
      notify('PDF export isn’t ready yet', 'It becomes available after the next app update.');
    } else {
      notify('Export failed', message);
    }
  }
}

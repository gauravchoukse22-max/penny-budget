import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { transactionsToCsv } from './queries';
import { createCard, createTransaction, listCards, listCategories } from './queries';
import { parseParticularsCsv, categorizeRows } from './particulars';
import type { Card, Category } from './models';

const FALLBACK_CARD_NAME = 'Unassigned (imported)';

export async function exportTransactionsCsv(transactions: Parameters<typeof transactionsToCsv>[0], categories: Category[], cards: Card[]) {
  const csv = transactionsToCsv(transactions, categories, cards);
  const path = FileSystem.cacheDirectory + `penny-budget-export-${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(path, csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Transactions' });
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

export async function importTransactionsCsv(): Promise<{ imported: number; skipped: number } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;

  const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return { imported: 0, skipped: 0 };

  const [categories, cards] = await Promise.all([listCategories(), listCards()]);
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const cardByName = new Map(cards.map((c) => [c.name.toLowerCase(), c.id]));

  let imported = 0;
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const [date, amountStr, categoryName, cardName, note, source] = parseCsvLine(line);
    const amount = parseFloat(amountStr);
    const cardId = cardByName.get((cardName ?? '').toLowerCase());
    if (!date || !(amount > 0) || !cardId) {
      skipped++;
      continue;
    }
    const categoryId = categoryByName.get((categoryName ?? '').toLowerCase()) ?? null;
    await createTransaction({
      amount,
      date,
      categoryId,
      cardId,
      note: note || null,
      source: source === 'imported' ? 'imported' : 'manual',
    });
    imported++;
  }

  return { imported, skipped };
}

/**
 * Imports a "Particulars" style monthly log — one line item per row, no
 * per-row date or card (the shape of a manually-kept household budget sheet,
 * as opposed to a bank/CSV export). Every row lands in the given month, on a
 * shared fallback card (auto-created once, named "Unassigned (imported)") so
 * the user can reassign the real card per-row afterward if they want to.
 * Savings-transfer rows (e.g. "Savings Transfer - Chase") are recognized and
 * excluded from spend — they move money, they aren't an expense.
 */
export async function importParticularsCsv(
  yearMonth: string
): Promise<{ imported: number; skipped: number; savingsTransfers: number; uncategorized: number } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv', copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;

  const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
  const rows = parseParticularsCsv(content);
  if (rows.length === 0) return { imported: 0, skipped: 0, savingsTransfers: 0, uncategorized: 0 };

  const categories = await listCategories();
  const categorized = categorizeRows(rows, categories);

  let cards = await listCards();
  let fallbackCard = cards.find((c) => c.name === FALLBACK_CARD_NAME);
  if (!fallbackCard) {
    fallbackCard = await createCard({ name: FALLBACK_CARD_NAME, lastFour: '0000', color: '#8E8E93' });
  }

  let imported = 0;
  let skipped = 0;
  let savingsTransfers = 0;
  let uncategorized = 0;

  for (const row of categorized) {
    if (row.isSavingsTransfer) {
      savingsTransfers++;
      continue;
    }
    if (!(row.amount > 0)) {
      skipped++;
      continue;
    }
    if (!row.categoryId) uncategorized++;
    await createTransaction({
      amount: row.amount,
      date: `${yearMonth}-01`,
      categoryId: row.categoryId,
      cardId: fallbackCard.id,
      note: row.particular,
      source: 'imported',
    });
    imported++;
  }

  return { imported, skipped, savingsTransfers, uncategorized };
}

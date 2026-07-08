// Pure parsing/categorization logic for importing a "Particulars" style monthly
// log — one line item per row (name + amount + optional remark), the shape of
// the owner's real household budget sheet (no date-per-row, no card-per-row).
// Kept dependency-free (no expo/RN imports) so it can be unit-tested with plain
// node/tsx, independent of the SQLite/DocumentPicker plumbing in csv.ts.
import type { Category } from './models';

export type ParticularRow = {
  /** Raw line-item label, e.g. "Rent+mortgage" or "Trader Joe's". */
  particular: string;
  amount: number;
  remark?: string;
};

export type CategorizedRow = ParticularRow & {
  categoryId: string | null;
  /** True for savings-account transfers (e.g. "Savings Transfer - Chase") — these move money to savings, they aren't spend. */
  isSavingsTransfer: boolean;
};

// Keyword → default-category-name rules, ordered most-specific-first. Matches
// against the DEFAULT_CATEGORIES set in lib/db.ts, but falls back gracefully
// (categoryId null) if the user has renamed/removed a category.
const KEYWORD_RULES: Array<{ keywords: string[]; categoryName: string }> = [
  { keywords: ['rent', 'mortgage'], categoryName: 'Mortgage' },
  { keywords: ['car emi', 'car payment', 'auto loan'], categoryName: 'Car Payment' },
  { keywords: ['utility', 'electric', 'water bill'], categoryName: 'Utilities' },
  { keywords: ['wifi', 'icloud', 'internet', 'subscription', 'netflix', 'spotify'], categoryName: 'Internet & Subscriptions' },
  { keywords: ['phone service', 'phone bill', 'cell phone'], categoryName: 'Phone Service' },
  { keywords: ['gas'], categoryName: 'Gas' },
  { keywords: ['restaurant', 'dining', 'takeout', 'doordash', 'uber eats'], categoryName: 'Dining' },
  { keywords: ['clothing', 'clothes'], categoryName: 'Clothing' },
  { keywords: ['baby', 'family'], categoryName: 'Family / Baby' },
  { keywords: ['ikea', 'home depot', 'lowes'], categoryName: 'Other' },
  {
    keywords: [
      'walmart',
      "trader joe's",
      'trader joes',
      'india mart',
      'indian bazaar',
      'kroger',
      'costco',
      "sam's club",
      "sam's",
      'grocery',
      'groceries',
      'safeway',
      'whole foods',
    ],
    categoryName: 'Groceries',
  },
];

const SAVINGS_TRANSFER_KEYWORDS = ['savings transfer', 'transfer to savings', 'move to savings'];

export function isSavingsTransfer(particular: string): boolean {
  const lower = particular.toLowerCase();
  return SAVINGS_TRANSFER_KEYWORDS.some((k) => lower.includes(k));
}

export function guessCategoryId(particular: string, categories: Category[]): string | null {
  const lower = particular.toLowerCase();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      const id = byName.get(rule.categoryName.toLowerCase());
      if (id) return id;
    }
  }
  return null;
}

export function categorizeRows(rows: ParticularRow[], categories: Category[]): CategorizedRow[] {
  return rows.map((row) => ({
    ...row,
    isSavingsTransfer: isSavingsTransfer(row.particular),
    categoryId: guessCategoryId(row.particular, categories),
  }));
}

/**
 * Parses a simple two/three-column "particular,amount,remark" CSV (no header
 * required, but one is skipped if the first cell isn't a valid line item).
 * Blank rows and section headers with no amount (e.g. "GROCERY") are skipped.
 */
export function parseParticularsCsv(content: string): ParticularRow[] {
  const rows: ParticularRow[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    const particular = (fields[0] ?? '').trim();
    const amount = parseFloat((fields[1] ?? '').replace(/[^0-9.-]/g, ''));
    if (!particular || !(amount > 0)) continue;
    rows.push({ particular, amount, remark: (fields[2] ?? '').trim() || undefined });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
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
  return fields.map((f) => f.trim());
}

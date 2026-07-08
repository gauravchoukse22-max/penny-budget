import * as SQLite from 'expo-sqlite';
import { uuid } from './uuid';
import { CATEGORY_PALETTE } from '../theme/colors';

const DB_NAME = 'pennybudget.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      lastFour TEXT NOT NULL,
      color TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      monthlyLimit REAL NOT NULL DEFAULT 0,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      categoryId TEXT,
      cardId TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(categoryId);
    CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(cardId);

    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      monthlyAmount REAL NOT NULL DEFAULT 0,
      sortOrder INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS savings_goal_transfers (
      id TEXT PRIMARY KEY NOT NULL,
      goalId TEXT NOT NULL,
      yearMonth TEXT NOT NULL,
      transferred INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (goalId) REFERENCES savings_goals(id) ON DELETE CASCADE,
      UNIQUE (goalId, yearMonth)
    );
    CREATE TABLE IF NOT EXISTS category_budgets (
      id TEXT PRIMARY KEY NOT NULL,
      categoryId TEXT NOT NULL,
      yearMonth TEXT NOT NULL,
      monthlyLimit REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE (categoryId, yearMonth)
    );
    CREATE TABLE IF NOT EXISTS savings_goal_budgets (
      id TEXT PRIMARY KEY NOT NULL,
      goalId TEXT NOT NULL,
      yearMonth TEXT NOT NULL,
      monthlyAmount REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (goalId) REFERENCES savings_goals(id) ON DELETE CASCADE,
      UNIQUE (goalId, yearMonth)
    );
    CREATE TABLE IF NOT EXISTS monthly_settings (
      id TEXT PRIMARY KEY NOT NULL,
      yearMonth TEXT NOT NULL UNIQUE,
      salary REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      currency TEXT NOT NULL DEFAULT 'USD',
      salaryMode TEXT NOT NULL DEFAULT 'fixed',
      fixedSalary REAL NOT NULL DEFAULT 0,
      onboarded INTEGER NOT NULL DEFAULT 0
    );
  `);

  const settingsRow = await db.getFirstAsync<{ id: number }>('SELECT id FROM app_settings WHERE id = 1');
  if (!settingsRow) {
    await db.runAsync('INSERT INTO app_settings (id, currency, salaryMode, fixedSalary, onboarded) VALUES (1, ?, ?, ?, 0)', [
      'USD',
      'fixed',
      0,
    ]);
  }

  // Self-heal columns added after initial release, so existing installs (whose
  // `cards` table predates billing-day tracking) don't crash on the new fields.
  const cardColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(cards)');
  const cardColumnNames = new Set(cardColumns.map((c) => c.name));
  if (!cardColumnNames.has('billDay')) {
    await db.execAsync('ALTER TABLE cards ADD COLUMN billDay INTEGER;');
  }
  if (!cardColumnNames.has('dueDay')) {
    await db.execAsync('ALTER TABLE cards ADD COLUMN dueDay INTEGER;');
  }

  return db;
}

export const DEFAULT_CATEGORIES: Array<{ name: string; icon: string; limit: number }> = [
  { name: 'Mortgage', icon: 'home', limit: 2000 },
  { name: 'Car Payment', icon: 'car-sport', limit: 450 },
  { name: 'Utilities', icon: 'flash', limit: 200 },
  { name: 'Internet & Subscriptions', icon: 'wifi', limit: 100 },
  { name: 'Phone Service', icon: 'phone-portrait', limit: 100 },
  { name: 'Groceries', icon: 'cart', limit: 600 },
  { name: 'Dining', icon: 'restaurant', limit: 250 },
  { name: 'Gas', icon: 'car', limit: 150 },
  { name: 'Clothing', icon: 'shirt', limit: 100 },
  { name: 'Family / Baby', icon: 'gift', limit: 200 },
  { name: 'Other', icon: 'ellipsis-horizontal-circle', limit: 150 },
];

/** New categories added after v1's initial default set. Inserted for existing
 * installs too (not just fresh ones) so upgrading users get them automatically. */
const CATEGORIES_ADDED_POST_LAUNCH = ['Car Payment', 'Internet & Subscriptions'];

// Mirrors a common household budget spreadsheet: a mix of emergency,
// milestone, and recurring savings buckets — all fully editable after setup.
export const DEFAULT_SAVINGS_GOALS: Array<{ name: string; amount: number }> = [
  { name: 'Emergency Fund', amount: 200 },
  { name: 'Vacation', amount: 100 },
  { name: 'Home Repairs', amount: 100 },
  { name: 'Child / Education Savings', amount: 150 },
  { name: 'Miscellaneous Savings', amount: 50 },
];

export async function seedDefaultCategoriesIfEmpty(): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM categories');
  if (existing && existing.count > 0) return;

  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const c = DEFAULT_CATEGORIES[i];
    await db.runAsync(
      'INSERT INTO categories (id, name, icon, color, monthlyLimit, sortOrder) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), c.name, c.icon, CATEGORY_PALETTE[i % CATEGORY_PALETTE.length], c.limit, i]
    );
  }
}

/** Adds any post-launch default categories the user doesn't already have (by name), without touching existing ones. No-op on a fresh install — seedDefaultCategoriesIfEmpty already includes them there. */
export async function addPostLaunchCategoriesIfMissing(): Promise<void> {
  const db = await getDb();
  const existing = await db.getAllAsync<{ name: string }>('SELECT name FROM categories');
  const existingNames = new Set(existing.map((c) => c.name));
  if (existingNames.size === 0) return; // fresh install — seedDefaultCategoriesIfEmpty handles it

  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM categories');
  let nextOrder = (maxRow?.maxOrder ?? -1) + 1;

  for (const name of CATEGORIES_ADDED_POST_LAUNCH) {
    if (existingNames.has(name)) continue;
    const def = DEFAULT_CATEGORIES.find((c) => c.name === name);
    if (!def) continue;
    await db.runAsync(
      'INSERT INTO categories (id, name, icon, color, monthlyLimit, sortOrder) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), def.name, def.icon, CATEGORY_PALETTE[nextOrder % CATEGORY_PALETTE.length], def.limit, nextOrder]
    );
    nextOrder++;
  }
}

export async function seedDefaultSavingsGoalsIfEmpty(): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM savings_goals');
  if (existing && existing.count > 0) return;

  for (let i = 0; i < DEFAULT_SAVINGS_GOALS.length; i++) {
    const g = DEFAULT_SAVINGS_GOALS[i];
    await db.runAsync('INSERT INTO savings_goals (id, name, monthlyAmount, sortOrder) VALUES (?, ?, ?, ?)', [
      uuid(),
      g.name,
      g.amount,
      i,
    ]);
  }
}

export function currentYearMonth(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { createCard, createTransaction, listCards } from '../lib/queries';
import { suggestCategory } from './smart-categorizer';
import type { Card } from '../lib/models';

// Client side of Plaid bank linking (family-only; see lib/feature-flags.ts).
//
// Trust boundary: the app NEVER sees a Plaid secret, public_token, or
// access_token. It opens Plaid's HOSTED Link page in the system browser
// (which is why this works in Expo Go — no native Plaid SDK), and everything
// token-shaped happens inside the Edge Functions against a table the client
// can't read. The app only receives display metadata and plain transactions.
//
// Local model: each linked bank account becomes a Card (named e.g.
// "Chase •••• 4412"), created on first sync; the account→card mapping and the
// set of already-imported Plaid transaction ids live in AsyncStorage.

const ACCOUNT_CARD_MAP_KEY = 'plaid.accountCardMap.v1';
const IMPORTED_IDS_KEY = 'plaid.importedTxnIds.v1';

export type LinkedAccount = { account_id: string; name: string; mask: string; subtype: string };
export type LinkedItem = { item_id: string; institution_name: string | null; accounts: LinkedAccount[] };

export type LinkResult =
  | { linked: true; institution: string | null }
  | { linked: false; message: string };

/**
 * Runs the whole link flow: link token -> hosted Link in the browser -> finish
 * on the server. Safe to call again after a cancelled browser session.
 */
export async function linkBankAccount(): Promise<LinkResult> {
  const { data: created, error: createErr } = await supabase.functions.invoke('plaid-create-link');
  if (createErr || !created?.hosted_link_url || !created?.link_token) {
    return { linked: false, message: 'Couldn’t start bank linking. Check that the Plaid functions are deployed.' };
  }

  // The browser session ends when Plaid redirects to pennybudget://bank-linked
  // (or the user closes the sheet). Either way, completion is decided
  // server-side by plaid-finish-link — the redirect itself carries no secrets.
  await WebBrowser.openAuthSessionAsync(created.hosted_link_url, 'pennybudget://bank-linked');

  const { data: finished, error: finishErr } = await supabase.functions.invoke('plaid-finish-link', {
    body: { link_token: created.link_token },
  });
  if (finishErr || finished?.error) {
    const code = finished?.error ?? '';
    if (code === 'link_not_completed') {
      return { linked: false, message: 'Linking wasn’t completed. Nothing was connected.' };
    }
    return { linked: false, message: 'Linking failed on the server. Nothing was connected.' };
  }
  return { linked: true, institution: finished?.institution_name ?? null };
}

async function readMap(key: string): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function readIdSet(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(IMPORTED_IDS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Finds or creates the local Card representing a linked bank account. */
async function ensureCardForAccount(
  account: LinkedAccount,
  institution: string | null,
  map: Record<string, string>,
  cards: Card[]
): Promise<{ cardId: string; created: boolean }> {
  const mapped = map[account.account_id];
  if (mapped && cards.some((c) => c.id === mapped)) return { cardId: mapped, created: false };

  const name = institution ? `${institution} ${account.name}` : account.name;
  const card = await createCard({
    name: name.slice(0, 40),
    lastFour: (account.mask ?? '').slice(-4),
    color: '#0A84FF',
  });
  map[account.account_id] = card.id;
  return { cardId: card.id, created: true };
}

export type BankSyncResult = {
  imported: number;
  cardsCreated: number;
  uncategorized: number;
  items: LinkedItem[];
} | { error: string };

/**
 * Pulls new transactions from every linked bank and writes them into the local
 * database. Pending transactions never arrive (filtered server-side); removed/
 * modified ones are left alone in v1 — imported rows are the user's to edit.
 */
export async function syncLinkedBanks(): Promise<BankSyncResult> {
  const { data, error } = await supabase.functions.invoke('plaid-sync');
  if (error || data?.error) return { error: 'Sync failed. Check that the Plaid functions are deployed.' };

  const items: LinkedItem[] = data?.items ?? [];
  const added: Array<{ id: string; account_id: string; date: string; name: string; amount: number }> = data?.added ?? [];

  const map = await readMap(ACCOUNT_CARD_MAP_KEY);
  const importedIds = await readIdSet();
  const cards = await listCards();
  const accountMeta = new Map<string, { account: LinkedAccount; institution: string | null }>();
  for (const item of items) {
    for (const account of item.accounts ?? []) {
      accountMeta.set(account.account_id, { account, institution: item.institution_name });
    }
  }

  let imported = 0;
  let cardsCreated = 0;
  let uncategorized = 0;

  for (const txn of added) {
    if (importedIds.has(txn.id)) continue;
    const meta = accountMeta.get(txn.account_id);
    if (!meta) continue;

    const { cardId, created } = await ensureCardForAccount(meta.account, meta.institution, map, cards);
    if (created) {
      cardsCreated++;
      cards.push({ id: cardId } as Card); // enough for the existence check above
    }

    const suggestion = await suggestCategory(txn.name);
    if (!suggestion) uncategorized++;
    await createTransaction({
      amount: txn.amount,
      date: txn.date,
      categoryId: suggestion?.categoryId ?? null,
      cardId,
      note: txn.name,
      source: 'imported',
    });
    importedIds.add(txn.id);
    imported++;
  }

  await AsyncStorage.setItem(ACCOUNT_CARD_MAP_KEY, JSON.stringify(map));
  await AsyncStorage.setItem(IMPORTED_IDS_KEY, JSON.stringify([...importedIds]));

  return { imported, cardsCreated, uncategorized, items };
}

/** Lists linked banks without importing anything (for the management screen). */
export async function listLinkedBanks(): Promise<LinkedItem[] | { error: string }> {
  // plaid-sync with no new data is the cheapest "list" we have server-side;
  // a dedicated endpoint isn't worth its own cold starts for a family feature.
  const result = await syncLinkedBanks();
  if ('error' in result) return { error: result.error };
  return result.items;
}

export async function unlinkBank(itemId: string): Promise<{ removed: boolean; message?: string }> {
  const { data, error } = await supabase.functions.invoke('plaid-unlink', { body: { item_id: itemId } });
  if (error || data?.error) return { removed: false, message: 'Couldn’t unlink. Try again.' };
  return { removed: true };
}

// Pulls new/changed/removed transactions for all of the calling user's linked
// items via /transactions/sync, advancing each item's stored cursor. Returns
// plain transaction data (no tokens). Plaid's sign convention — positive =
// money leaving the account — matches the app's (positive = spend), so amounts
// pass through unchanged.
//
// Deploy:  supabase functions deploy plaid-sync

import { plaidPost, getCallingUser, adminClient, json } from '../_shared/plaid.ts';

type SyncResponse = {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: Array<{ transaction_id: string }>;
  next_cursor: string;
  has_more: boolean;
};

type PlaidTxn = {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
};

function mapTxn(t: PlaidTxn) {
  return {
    id: t.transaction_id,
    account_id: t.account_id,
    date: t.authorized_date ?? t.date,
    name: t.merchant_name ?? t.name,
    amount: t.amount,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getCallingUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const admin = adminClient();
    const { data: items, error } = await admin
      .from('plaid_items')
      .select('item_id, access_token, sync_cursor, institution_name, accounts')
      .eq('user_id', user.id);
    if (error) return json({ error: 'load_items_failed' }, 500);

    const added: ReturnType<typeof mapTxn>[] = [];
    const modified: ReturnType<typeof mapTxn>[] = [];
    const removed: string[] = [];
    const itemsOut: Array<{ item_id: string; institution_name: string | null; accounts: unknown }> = [];

    for (const item of items ?? []) {
      let cursor: string | undefined = item.sync_cursor ?? undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await plaidPost<SyncResponse>('/transactions/sync', {
          access_token: item.access_token,
          cursor,
          count: 500,
        });
        for (const t of page.added) if (!t.pending) added.push(mapTxn(t));
        for (const t of page.modified) if (!t.pending) modified.push(mapTxn(t));
        for (const r of page.removed) removed.push(r.transaction_id);
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
      await admin
        .from('plaid_items')
        .update({ sync_cursor: cursor, updated_at: new Date().toISOString() })
        .eq('item_id', item.item_id);
      itemsOut.push({ item_id: item.item_id, institution_name: item.institution_name, accounts: item.accounts });
    }

    return json({ added, modified, removed, items: itemsOut });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'sync_failed' }, 502);
  }
});

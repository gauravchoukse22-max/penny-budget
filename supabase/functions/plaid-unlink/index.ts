// Unlinks a bank: revokes the item at Plaid (/item/remove — this also stops
// Trial-plan Item usage) and deletes the stored row. Transactions already in
// the app's local database stay there; only the connection is removed.
//
// Deploy:  supabase functions deploy plaid-unlink

import { plaidPost, getCallingUser, adminClient, json } from '../_shared/plaid.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getCallingUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const { item_id } = await req.json();
    if (typeof item_id !== 'string' || !item_id) return json({ error: 'missing_item_id' }, 400);

    const admin = adminClient();
    const { data: item, error } = await admin
      .from('plaid_items')
      .select('access_token')
      .eq('item_id', item_id)
      .eq('user_id', user.id) // scope to the caller — can't unlink someone else's
      .maybeSingle();
    if (error) return json({ error: 'load_failed' }, 500);
    if (!item) return json({ error: 'not_found' }, 404);

    try {
      await plaidPost('/item/remove', { access_token: item.access_token });
    } catch {
      // Best-effort: the item may already be revoked at Plaid. Still delete
      // our row so the app stops trying to sync it.
    }
    await admin.from('plaid_items').delete().eq('item_id', item_id).eq('user_id', user.id);
    return json({ removed: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unlink_failed' }, 502);
  }
});

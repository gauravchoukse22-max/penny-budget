// Completes a Hosted Link session. The browser flow ends server-side at Plaid;
// the public_token is retrieved via /link/token/get (never passes through the
// app), exchanged for an access_token, and stored in plaid_items — a table the
// client cannot read (RLS deny-all). Returns only display-safe metadata.
//
// Deploy:  supabase functions deploy plaid-finish-link

import { plaidPost, getCallingUser, adminClient, json } from '../_shared/plaid.ts';

type LinkGetResponse = {
  link_sessions?: Array<{
    results?: {
      item_add_results?: Array<{ public_token?: string }>;
    };
  }>;
};

type ExchangeResponse = { access_token: string; item_id: string };

type AccountsResponse = {
  accounts: Array<{ account_id: string; name: string; mask: string | null; subtype: string | null }>;
  item: { institution_name?: string | null; institution_id?: string | null };
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getCallingUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const { link_token } = await req.json();
    if (typeof link_token !== 'string' || !link_token) return json({ error: 'missing_link_token' }, 400);

    const linkGet = await plaidPost<LinkGetResponse>('/link/token/get', { link_token });
    const publicToken = linkGet.link_sessions
      ?.flatMap((s) => s.results?.item_add_results ?? [])
      .map((r) => r.public_token)
      .find((t): t is string => typeof t === 'string');
    if (!publicToken) return json({ error: 'link_not_completed' }, 409);

    const exchanged = await plaidPost<ExchangeResponse>('/item/public_token/exchange', {
      public_token: publicToken,
    });

    const accountsRes = await plaidPost<AccountsResponse>('/accounts/get', {
      access_token: exchanged.access_token,
    });
    const accounts = accountsRes.accounts.map((a) => ({
      account_id: a.account_id,
      name: a.name,
      mask: a.mask ?? '',
      subtype: a.subtype ?? '',
    }));
    const institution = accountsRes.item?.institution_name ?? null;

    const admin = adminClient();
    const { error } = await admin.from('plaid_items').upsert({
      item_id: exchanged.item_id,
      user_id: user.id,
      access_token: exchanged.access_token,
      institution_name: institution,
      accounts,
      updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: 'store_failed' }, 500);

    return json({ item_id: exchanged.item_id, institution_name: institution, accounts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'finish_link_failed' }, 502);
  }
});

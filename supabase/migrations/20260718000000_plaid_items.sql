-- Plaid bank connections (family-only feature, Plaid Trial plan).
--
-- SECURITY MODEL: access tokens are server-side secrets. RLS is enabled with
-- NO policies, so authenticated clients can read/write NOTHING here — every
-- interaction goes through the Edge Functions (plaid-create-link,
-- plaid-finish-link, plaid-sync, plaid-unlink), which use the service role and
-- never return an access_token to the client.

create table if not exists public.plaid_items (
  item_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_token text not null,
  institution_name text,
  -- [{ account_id, name, mask, subtype }] — shape returned by /accounts/get,
  -- minus balances (not stored).
  accounts jsonb not null default '[]'::jsonb,
  -- /transactions/sync cursor; null until the first sync.
  sync_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_items_user_idx on public.plaid_items (user_id);

alter table public.plaid_items enable row level security;
-- Intentionally NO policies: deny-all for anon/authenticated. Service role
-- (Edge Functions) bypasses RLS.

revoke all on public.plaid_items from anon, authenticated;

-- Stores the Apple refresh token needed to revoke Sign in with Apple access at
-- account-deletion time (Guideline 5.1.1(v)). Written and read ONLY by Edge
-- Functions using the service role; never exposed to clients.

create table if not exists public.apple_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  created_at    timestamptz not null default now()
);

alter table public.apple_tokens enable row level security;

-- No policies are defined on purpose: with RLS enabled and zero policies, the
-- anon/authenticated roles can neither read nor write this table. The Edge
-- Functions use the service role, which bypasses RLS.
revoke all on public.apple_tokens from anon, authenticated;

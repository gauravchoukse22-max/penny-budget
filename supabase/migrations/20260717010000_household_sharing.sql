-- Family sharing: co-edit ONE shared household budget.
--
-- Model: a household owns a single shared dataset. Members' local budget rows
-- sync through the existing offline-first engine (features/cloudkit-sync.ts) via
-- a generic key/value mirror table (household_records) — one row per synced
-- budget record, payload as JSONB. RLS scopes everything to household membership
-- so one household can never read or write another's data. Membership changes go
-- through SECURITY DEFINER RPCs (below), never raw table writes.

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our Household',
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  email        text,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists idx_household_members_user on public.household_members (user_id);

create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  code         text not null unique,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);
create index if not exists idx_household_invites_code on public.household_invites (code);

-- The shared budget data. record_type is a local table name (cards, categories,
-- transactions, …); record_id is that row's uuid; payload is the whole row.
create table if not exists public.household_records (
  household_id uuid not null references public.households (id) on delete cascade,
  record_type  text not null,
  record_id    text not null,
  payload      jsonb not null default '{}'::jsonb,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  primary key (household_id, record_type, record_id)
);
create index if not exists idx_household_records_watermark
  on public.household_records (household_id, updated_at);

-- ── Membership helper (avoids recursive RLS on household_members) ───────────

-- SECURITY DEFINER so a policy can call it without needing its own SELECT
-- policy on household_members (which would recurse).
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_records enable row level security;

-- households: members may read; no direct writes (use RPCs).
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (public.is_household_member(id));

-- household_members: a member may read the roster of their own household(s).
drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select using (public.is_household_member(household_id));

-- household_records: full read/write for members of that household only.
drop policy if exists household_records_select on public.household_records;
create policy household_records_select on public.household_records
  for select using (public.is_household_member(household_id));

drop policy if exists household_records_insert on public.household_records;
create policy household_records_insert on public.household_records
  for insert with check (public.is_household_member(household_id));

drop policy if exists household_records_update on public.household_records;
create policy household_records_update on public.household_records
  for update using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- household_invites: members may read/create invites for their household; the
-- accept path is a SECURITY DEFINER RPC so a joiner (not yet a member) can use it.
drop policy if exists household_invites_select on public.household_invites;
create policy household_invites_select on public.household_invites
  for select using (public.is_household_member(household_id));

drop policy if exists household_invites_insert on public.household_invites;
create policy household_invites_insert on public.household_invites
  for insert with check (public.is_household_member(household_id) and created_by = auth.uid());

-- ── Membership RPCs (SECURITY DEFINER, validated) ───────────────────────────

create or replace function public.create_household(household_name text default 'Our Household')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.households (name, created_by) values (coalesce(nullif(household_name, ''), 'Our Household'), auth.uid())
    returning id into new_id;
  insert into public.household_members (household_id, user_id, email, role)
    values (new_id, auth.uid(), (select email from auth.users where id = auth.uid()), 'owner');
  return new_id;
end;
$$;

-- Generates a short, human-shareable invite code.
create or replace function public.create_household_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_household_member(hid) then
    raise exception 'Not a member of this household';
  end if;
  -- 8 chars from a base32-ish alphabet (no ambiguous 0/O/1/I).
  new_code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=OoIl01', 'ABCDEFGHJ'), 1, 8));
  insert into public.household_invites (household_id, code, created_by)
    values (hid, new_code, auth.uid());
  return new_code;
end;
$$;

create or replace function public.join_household(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.household_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into inv from public.household_invites where code = upper(invite_code);
  if not found then
    raise exception 'Invalid invite code';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invite has expired';
  end if;
  insert into public.household_members (household_id, user_id, email, role)
    values (inv.household_id, auth.uid(), (select email from auth.users where id = auth.uid()), 'member')
    on conflict (household_id, user_id) do nothing;
  update public.household_invites
    set used_by = auth.uid(), used_at = now()
    where id = inv.id and used_by is null;
  return inv.household_id;
end;
$$;

create or replace function public.leave_household(hid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.household_members where household_id = hid and user_id = auth.uid();
end;
$$;

-- Owner-only removal of another member.
create or replace function public.remove_household_member(hid uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only the household owner can remove members';
  end if;
  if target = auth.uid() then
    raise exception 'Use leave_household to remove yourself';
  end if;
  delete from public.household_members where household_id = hid and user_id = target;
end;
$$;

-- The set of households the caller belongs to (id, name, role, member_count).
create or replace function public.my_households()
returns table (id uuid, name text, role text, member_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select h.id, h.name, m.role, (select count(*) from public.household_members mm where mm.household_id = h.id)
  from public.households h
  join public.household_members m on m.household_id = h.id
  where m.user_id = auth.uid();
$$;

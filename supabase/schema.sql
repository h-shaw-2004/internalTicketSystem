-- Internal Ticket System — database schema
-- Supabase is used as the database only. Auth/API logic lives in this repo.
-- Run this in the Supabase SQL editor. Safe to re-run.

create extension if not exists "pgcrypto";

-- Account types, lowest privilege first: client => agency => admin
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_role') then
    create type account_role as enum ('client', 'agency', 'admin');
  end if;
end
$$;

create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  full_name     text not null,
  password_hash text not null,
  role          account_role not null default 'client',
  created_at    timestamptz not null default now()
);

-- Emails are matched case-insensitively at login, so enforce that in the index.
create unique index if not exists users_email_lower_idx on public.users (lower(email));

-- --------------------------------------------------------------------------
-- Account hierarchy
--
--   admin  (no parent)
--     └── agency   parent = an admin
--           └── client   parent = an agency
--
-- One parent each, so "a client has exactly one agency" and "an agency has
-- exactly one admin" are structural facts, not app-level conventions.
--
-- parent_role duplicates the parent's role on purpose. It is what makes the
-- composite foreign key below able to assert *what kind* of account the parent
-- is, so "an agency's parent must be an admin" is enforced by Postgres rather
-- than by a trigger or by trusting the client. src/api/auth.js writes it.
-- --------------------------------------------------------------------------

alter table public.users add column if not exists parent_id uuid;
alter table public.users add column if not exists parent_role account_role;

-- Accounts created by an admin or agency are given a generated temporary
-- password and must replace it before they can use anything. Cleared by
-- setInitialPassword in src/api/auth.js. Seeded accounts are exempt so their
-- documented credentials keep working.
alter table public.users
  add column if not exists must_change_password boolean not null default false;

create index if not exists users_parent_id_idx on public.users (parent_id);

-- One-time cleanup. Accounts created before the hierarchy existed have no
-- parent and cannot satisfy users_hierarchy_check, so the constraint below
-- would fail to apply. This is test data only — against real accounts you would
-- backfill parent_id instead of deleting. No-op once the constraint is in place.
delete from public.users where role <> 'admin' and parent_id is null;

do $$
begin
  -- Target for the composite FK: lets another row reference (id, role) together.
  if not exists (select 1 from pg_constraint where conname = 'users_id_role_key') then
    alter table public.users add constraint users_id_role_key unique (id, role);
  end if;

  -- The parent must exist AND still hold the role we recorded for it. Because
  -- this references (id, role), demoting an agency that still has clients is
  -- rejected rather than silently orphaning them.
  if not exists (select 1 from pg_constraint where conname = 'users_parent_fkey') then
    alter table public.users
      add constraint users_parent_fkey
      foreign key (parent_id, parent_role)
      references public.users (id, role)
      on delete restrict;
  end if;

  -- Which parent role each account type demands, and that admins have none.
  if not exists (select 1 from pg_constraint where conname = 'users_hierarchy_check') then
    alter table public.users
      add constraint users_hierarchy_check check (
        (role = 'admin'  and parent_id is null     and parent_role is null)
        or (role = 'agency' and parent_id is not null and parent_role = 'admin')
        or (role = 'client' and parent_id is not null and parent_role = 'agency')
      );
  end if;
end
$$;

create table if not exists public.sessions (
  token      text primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);

-- RLS is enabled so nothing is reachable with the anon key by default.
-- The browser client only ever needs the columns exposed by the policies below;
-- once the API server exists it will use the service-role key and bypass these.
alter table public.users enable row level security;
alter table public.sessions enable row level security;

-- INTERIM POLICIES — front-end-only stage.
-- These exist so the React app can talk to the database before the API server
-- is built. Delete every one of them once auth moves server-side.
drop policy if exists "interim: anon read users" on public.users;
create policy "interim: anon read users"
  on public.users for select to anon using (true);

-- Account creation is gated on the *acting* user's role, and at this stage there
-- is no database-level identity to check that against — src/api/auth.js enforces
-- "admin creates agency, agency creates client". All this policy can still do is
-- guarantee no admin is ever mintable from the browser.
drop policy if exists "interim: anon insert users" on public.users;
create policy "interim: anon insert users"
  on public.users for insert to anon with check (role in ('client', 'agency'));

-- Needed so a first-time user can replace their temporary password. This is the
-- widest of the interim holes: RLS cannot restrict which columns an update
-- touches, so with the anon key this permits editing any row. Nothing but
-- src/api/auth.js is meant to use it, and it goes with the rest of these.
drop policy if exists "interim: anon update users" on public.users;
create policy "interim: anon update users"
  on public.users for update to anon using (true) with check (true);

drop policy if exists "interim: anon manage sessions" on public.sessions;
create policy "interim: anon manage sessions"
  on public.sessions for all to anon using (true) with check (true);

-- Internal Ticket System — database schema
-- Supabase is used as the database only. Auth/API logic lives in this repo.
-- Run this in the Supabase SQL editor.

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
-- is built. Delete all four once auth moves server-side.
drop policy if exists "interim: anon read users" on public.users;
create policy "interim: anon read users"
  on public.users for select to anon using (true);

drop policy if exists "interim: anon insert users" on public.users;
create policy "interim: anon insert users"
  on public.users for insert to anon with check (role = 'client');

drop policy if exists "interim: anon manage sessions" on public.sessions;
create policy "interim: anon manage sessions"
  on public.sessions for all to anon using (true) with check (true);

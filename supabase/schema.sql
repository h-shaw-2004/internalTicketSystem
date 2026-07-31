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

-- --------------------------------------------------------------------------
-- Tickets
--
-- Raised by a client, worked by that client's agency, and escalated upward to
-- the agency's admin when the agency cannot resolve it. Escalation is a request
-- for help rather than a handover: both the agency and the admin can keep
-- changing the status afterwards.
-- --------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum ('open', 'in_progress', 'with_client', 'on_hold', 'resolved');
  end if;

  if not exists (select 1 from pg_type where typname = 'ticket_urgency') then
    create type ticket_urgency as enum ('low', 'medium', 'high', 'critical');
  end if;

  if not exists (select 1 from pg_type where typname = 'ticket_department') then
    create type ticket_department as enum ('hardware', 'software', 'network', 'access', 'other');
  end if;
end
$$;

create table if not exists public.tickets (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  description  text not null,
  department   ticket_department not null,
  urgency      ticket_urgency not null,
  status       ticket_status not null default 'open',

  -- Who raised it, and the agency responsible. agency_id is copied from the
  -- client's parent at creation rather than joined through on every read: if a
  -- client is ever moved to another agency, existing tickets stay with the
  -- agency that actually handled them.
  client_id    uuid not null references public.users (id) on delete cascade,
  agency_id    uuid not null references public.users (id) on delete restrict,

  -- Both set together or neither. escalated_to is the agency's admin.
  escalated_at timestamptz,
  escalated_to uuid references public.users (id) on delete set null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint tickets_escalation_check check (
    (escalated_at is null and escalated_to is null)
    or (escalated_at is not null and escalated_to is not null)
  )
);

-- When a client last refused a resolution. Genuinely new information rather
-- than a duplicate of `status`: an open ticket that came back is not the same
-- thing as one nobody has looked at yet, and nothing else records the
-- difference. Mirrors escalated_at, and like it is never cleared.
alter table public.tickets add column if not exists reopened_at timestamptz;

create index if not exists tickets_client_id_idx on public.tickets (client_id);
create index if not exists tickets_agency_id_idx on public.tickets (agency_id);
create index if not exists tickets_escalated_to_idx on public.tickets (escalated_to);
create index if not exists tickets_created_at_idx on public.tickets (created_at desc);

-- --------------------------------------------------------------------------
-- Ticket messages
--
-- A two-way thread per ticket, between the client who raised it and the agency
-- working it. Once a ticket is escalated the agency's admin can join in — until
-- then an admin may read a thread belonging to one of its agencies but not post
-- to it, so browsing for oversight never turns into walking uninvited into a
-- client conversation. canPostMessage in shared/tickets.js is that rule; the
-- server enforces it in server/routes/tickets.js.
--
-- author_role is a snapshot, duplicated here on purpose, for the same reason
-- tickets.agency_id is copied from the client's parent rather than joined
-- through: if an account is later promoted, its old messages must stay
-- attributed the way they were actually sent.
-- --------------------------------------------------------------------------

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),

  ticket_id   uuid not null references public.tickets (id) on delete cascade,

  -- restrict, not cascade: deleting an account must not silently punch holes in
  -- a conversation the other party still relies on.
  author_id   uuid not null references public.users (id) on delete restrict,
  author_role account_role not null,

  body        text not null,
  created_at  timestamptz not null default now(),

  -- Mirrors checkMessage in shared/tickets.js. Whitespace-only is not a message.
  constraint ticket_messages_body_check
    check (length(btrim(body)) between 1 and 4000)
);

-- Threads are always read whole and in order, so one composite index serves
-- every query the API makes.
create index if not exists ticket_messages_thread_idx
  on public.ticket_messages (ticket_id, created_at);

-- What a message *is*. Ordinary messages are typed by a person; a 'reopen' row
-- is the reason a client gave for refusing a resolution, and the thread renders
-- it as an event so an agency can tell a returning problem from a new one.
--
-- Deliberately text + a check constraint rather than a Postgres enum. The set
-- will grow (status changes, assignment notes), and widening a check constraint
-- is a drop-and-add in this file, whereas `alter type ... add value` is a
-- migration that cannot be rolled back in a transaction.
alter table public.ticket_messages
  add column if not exists kind text not null default 'message';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_messages_kind_check') then
    alter table public.ticket_messages
      add constraint ticket_messages_kind_check check (kind in ('message', 'reopen'));
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Read state
--
-- "Unread" is a fact about a *viewer*, not about a ticket, so it cannot be
-- derived from ticket_messages alone. One row per person per ticket they have
-- opened; no row at all means they have never looked, which is exactly the
-- right default — everything on it is unread.
--
-- Unread for a viewer is therefore: messages on the ticket that someone else
-- wrote after their last_read_at. Excluding your own authorship is what stops
-- sending a reply from marking your own ticket unread.
-- --------------------------------------------------------------------------

create table if not exists public.ticket_reads (
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),

  primary key (ticket_id, user_id)
);

-- The lists look this up per viewer across many tickets at once.
create index if not exists ticket_reads_user_idx on public.ticket_reads (user_id);

-- --------------------------------------------------------------------------
-- Row level security
--
-- Nothing but the API server in /server touches these tables, and it connects
-- as the database owner, which RLS does not apply to. So RLS is enabled with
-- NO policies at all: every other role — including the `anon` key Supabase
-- publishes — matches no policy and therefore sees nothing.
--
-- That is the point of having written the API. Access rules ("an agency sees
-- only its own clients", "only an admin creates agencies") are expressed once,
-- in server code, against a session the caller cannot forge. They are no longer
-- guesses made in a browser that anyone could skip with curl.
-- --------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_reads enable row level security;

-- The front-end-only stage published these to the anon role. They are holes now
-- that a real API exists, so re-running this file removes them.
drop policy if exists "interim: anon read users" on public.users;
drop policy if exists "interim: anon insert users" on public.users;
drop policy if exists "interim: anon update users" on public.users;
drop policy if exists "interim: anon manage sessions" on public.sessions;
drop policy if exists "interim: anon read tickets" on public.tickets;
drop policy if exists "interim: anon insert tickets" on public.tickets;
drop policy if exists "interim: anon update tickets" on public.tickets;

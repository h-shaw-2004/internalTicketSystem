-- Internal Ticket System — test accounts, one per role.
-- GENERATED FILE — edit scripts/generate-seed.mjs and run `npm run seed`.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. The editor runs as the
-- postgres role, which bypasses RLS — that is the point. There is no public
-- sign-up: agencies are created by an admin and clients by an agency, so the
-- first admin has to come from here.
--
-- Hierarchy created:
--   admin@email.com
--     └── agency@email.com
--           └── client@email.com
--
-- Credentials (local development only — these passwords are trivially
-- guessable, never run this against anything real):
--   admin  admin@email.com      admin0Password?
--   agency agency@email.com     agency0Password?
--   client client@email.com     client0Password?
--
-- Safe to re-run: existing rows are reset to these values rather than duplicated.

-- admin — top of the tree
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
values ('admin@email.com', 'Admin Test User', 'pbkdf2$sha256$210000$gR2lWITx7vUThMHJziB4dQ==$NO+SfnkJCJf/zLf8VjNDU9llx23xmqIKeJm1m9x99D4=', 'admin', null, null, false)
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- agency — belongs to admin@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'agency@email.com', 'Agency Test User', 'pbkdf2$sha256$210000$DT5r/LvNuygUb4lkm682/w==$FXw4j7AI5qIudcRHnG/CLIB3haPNWQ6y000KRO6/bQM=', 'agency', id, 'admin', false
from public.users
where email = 'admin@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- client — belongs to agency@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'client@email.com', 'Client Test User', 'pbkdf2$sha256$210000$BXZPn7QiQ8RA5h4aDcINng==$SS4OTInpMtKxWOIF7L40SpC8cfyWPHGiFbV4w0DuPcI=', 'client', id, 'agency', false
from public.users
where email = 'agency@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- Drop any sessions these accounts already held, so a re-seed forces a fresh
-- sign-in rather than leaving a stale token pointing at the old row.
delete from public.sessions
where user_id in (select id from public.users where email in ('admin@email.com', 'agency@email.com', 'client@email.com'));

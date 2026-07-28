-- Internal Ticket System — test accounts.
-- GENERATED FILE — edit scripts/generate-seed.mjs and run `npm run seed`.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. The editor runs as the
-- postgres role, which bypasses RLS — that is the point. There is no public
-- sign-up: agencies are created by an admin and clients by an agency, so the
-- first admin has to come from here.
--
-- Hierarchy created:
--   admin1@email.com
--   ├── agency1@email.com
--   │   └── client1@email.com
--   └── agency2@email.com
--       └── client2@email.com
--
-- Credentials (local development only — these passwords are trivially
-- guessable, never run this against anything real):
--   admin  admin1@email.com     admin1Password?
--   agency agency1@email.com    agency1Password?
--   agency agency2@email.com    agency2Password?
--   client client1@email.com    client1Password?
--   client client2@email.com    client2Password?
--
-- Safe to re-run: existing rows are reset to these values rather than duplicated.

-- admin1 (admin) — top of the tree
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
values ('admin1@email.com', 'Admin 1 Test User', 'pbkdf2$sha256$210000$e98bvczQQTymCmJsJC69RQ==$WNNVBJGvFqNaNbkDbDBv1g3gj7TrBLO1LdV4SyXcSdQ=', 'admin', null, null, false)
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- agency1 (agency) — belongs to admin1@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'agency1@email.com', 'Agency 1 Test User', 'pbkdf2$sha256$210000$Oi8a9rkA/lfAGMWmaThbcQ==$23ayTE1Gdj9RbFXJmh6BuGkh07xKDaKiG1e9TAsDjDc=', 'agency', id, 'admin', false
from public.users
where email = 'admin1@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- agency2 (agency) — belongs to admin1@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'agency2@email.com', 'Agency 2 Test User', 'pbkdf2$sha256$210000$zoTFljqKwF8dGjpolgjL7A==$vBZag3Nu/6ehQUdqVZkMLmQZYQwAGmuRVgMGiqxluHo=', 'agency', id, 'admin', false
from public.users
where email = 'admin1@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- client1 (client) — belongs to agency1@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'client1@email.com', 'Client 1 Test User', 'pbkdf2$sha256$210000$Alm9D5DuTPHIfImA9Cunxw==$324yNUZ5NRq5XNliegwASY/iRycotPfN4VSd8kcmFtI=', 'client', id, 'agency', false
from public.users
where email = 'agency1@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- client2 (client) — belongs to agency2@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'client2@email.com', 'Client 2 Test User', 'pbkdf2$sha256$210000$4vQ5/BV6etvYw29BRv+07A==$bHVJv2aCBIbyC4ZmXUH+xC46UZGkCkqfLPPF8WmYvVg=', 'client', id, 'agency', false
from public.users
where email = 'agency2@email.com'
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
where user_id in (select id from public.users where email in ('admin1@email.com', 'agency1@email.com', 'agency2@email.com', 'client1@email.com', 'client2@email.com'));

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
values ('admin1@email.com', 'Admin 1 Test User', 'pbkdf2$sha256$210000$PGG+VkkgNZeoNa/HuJ/usQ==$C9z1br97FxC26ukKMgSDJ2kGT+R1esnFSOmDehZMerU=', 'admin', null, null, false)
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- agency1 (agency) — belongs to admin1@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'agency1@email.com', 'Agency 1 Test User', 'pbkdf2$sha256$210000$IWbBJbOWO6XDEWhKKStlCA==$rBvBOSzfLCTO+rv7V0bcQ/9rI89bZ/Cger3EjD8uEGk=', 'agency', id, 'admin', false
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
select 'agency2@email.com', 'Agency 2 Test User', 'pbkdf2$sha256$210000$cGdKmDpDMUXfW1ZjOZsSJA==$uq8vzlNbWxN00uDelh/XC+is6Vd8oQMsmt103PWo5n8=', 'agency', id, 'admin', false
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
select 'client1@email.com', 'Client 1 Test User', 'pbkdf2$sha256$210000$wlVzXmc3g3YD1Le9jHSspg==$fyzqcDj3DQyQv5oQ1nrWMdi3cxYY+iiWr9FVJSIV0ks=', 'client', id, 'agency', false
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
select 'client2@email.com', 'Client 2 Test User', 'pbkdf2$sha256$210000$yJKHgTDx6O50klIx4kZpig==$4TaU/C5QjFmxb8ssooNiekVnokvLpbtJ50vGQtdHcQk=', 'client', id, 'agency', false
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

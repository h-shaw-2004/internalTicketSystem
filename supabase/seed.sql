-- Internal Ticket System — test accounts and demo tickets.
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
-- Tickets created (dates are relative to when this runs, so they never go
-- stale). Between them they cover every status, urgency and department, an open
-- escalation and a spent one, a reopened ticket, resolved work in both agencies'
-- archives, and unread replies waiting for each role:
--    1. client1  Laptop won't boot after the latest update
--       in_progress · escalated · unread for admin1
--    2. client1  Shared drive keeps disconnecting
--       open · unread for agency1
--    3. client1  New starter needs access to the CRM
--       with_client · unread for client1
--    4. client1  Meeting room screen shows last week's schedule
--       on_hold
--    5. client1  Invoicing export produced empty PDFs
--       resolved
--    6. client1  VPN drops every few minutes
--       open · reopened · unread for agency1
--    7. client1  Email stopped syncing on mobile
--       resolved · escalated
--    8. client2  Card reader in reception won't pair
--       open · unread for agency2
--    9. client2  Website contact form is silently failing
--       in_progress · escalated · unread for admin1
--   10. client2  Revoke access for a leaver
--       resolved
--
-- Safe to re-run: every row below has a fixed id and is reset in place rather
-- than duplicated. Note that re-running restores the demo tickets exactly as
-- listed above — replies you added by hand to a seeded ticket are removed.

-- admin1 (admin) — top of the tree
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
values ('admin1@email.com', 'Admin 1 Test User', 'pbkdf2$sha256$210000$SHK6rvA0aKItXN/YtaRKbw==$Pnpd9RUPU4kxpU99x3ZK3YyiQW5IIktipETKxZTAjiA=', 'admin', null, null, false)
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- agency1 (agency) — belongs to admin1@email.com
insert into public.users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
select 'agency1@email.com', 'Agency 1 Test User', 'pbkdf2$sha256$210000$vmPQvIBvdtOBIusNIqTw7Q==$Ujz4uVLeHdGJDJgF20ONpyrq/bEo7rm8/ph3T+qGKsI=', 'agency', id, 'admin', false
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
select 'agency2@email.com', 'Agency 2 Test User', 'pbkdf2$sha256$210000$g3FjE53WHOIUVphzylelFA==$95GSIFxyqwxUDozKxrGo7FvdqOQuuM9hd00qfRgerHU=', 'agency', id, 'admin', false
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
select 'client1@email.com', 'Client 1 Test User', 'pbkdf2$sha256$210000$RhNJuOqqovRrhOhY4cPP3w==$j2fBknIKXN3zRubzauCZwqmO1O5Ro6FPBjTV6VRdEFg=', 'client', id, 'agency', false
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
select 'client2@email.com', 'Client 2 Test User', 'pbkdf2$sha256$210000$zasHO9jH8BiblI7WWyG1JA==$EvViuolW8N/0SN50n1n/riGHsxaOlrlgubpj2RLoPEM=', 'client', id, 'agency', false
from public.users
where email = 'agency2@email.com'
on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;

-- --------------------------------------------------------------------------
-- Tickets
--
-- agency_id comes from the client's own parent and escalated_to from that
-- agency's parent, the same way POST /tickets and the escalate route derive
-- them. Nothing here names an agency directly, so the seed cannot create a
-- ticket the API would refuse to.
-- --------------------------------------------------------------------------

-- 1. Laptop won't boot after the latest update — client1, in_progress, escalated
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000001', 'Laptop won''t boot after the latest update', 'Our finance lead''s laptop stops at the manufacturer logo and goes no further. It started right after Tuesday''s update installed overnight. She has payroll to run this week.',
       'hardware', 'critical', 'in_progress',
       c.id, a.id,
       now() - interval '4 days',
       a.parent_id,
       null,
       now() - interval '6 days', now() - interval '3 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 2. Shared drive keeps disconnecting — client1, open
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000002', 'Shared drive keeps disconnecting', 'The shared drive drops off for everyone in the office several times a day. Reconnecting works but anything unsaved is lost.',
       'network', 'high', 'open',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '2 days', now() - interval '1 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 3. New starter needs access to the CRM — client1, with_client
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000003', 'New starter needs access to the CRM', 'A new account manager starts on Monday and needs the CRM plus whichever shared inbox their team uses.',
       'access', 'medium', 'with_client',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '4 days', now() - interval '3 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 4. Meeting room screen shows last week's schedule — client1, on_hold
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000004', 'Meeting room screen shows last week''s schedule', 'The booking panel outside the large meeting room is a week behind. Bookings made in the calendar do not reach it.',
       'other', 'low', 'on_hold',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '9 days', now() - interval '8 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 5. Invoicing export produced empty PDFs — client1, resolved
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000005', 'Invoicing export produced empty PDFs', 'The month-end invoice export downloads as usual, but every PDF inside it is zero bytes.',
       'software', 'high', 'resolved',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '14 days', now() - interval '11 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 6. VPN drops every few minutes — client1, open, reopened
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000006', 'VPN drops every few minutes', 'Anyone working from home is disconnected from the VPN every five to ten minutes.',
       'network', 'medium', 'open',
       c.id, a.id,
       null,
       null,
       now() - interval '1 days',
       now() - interval '20 days', now() - interval '1 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 7. Email stopped syncing on mobile — client1, resolved, escalated
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000007', 'Email stopped syncing on mobile', 'Phones stopped pulling new mail over the weekend. Desktops are unaffected.',
       'software', 'medium', 'resolved',
       c.id, a.id,
       now() - interval '23 days',
       a.parent_id,
       null,
       now() - interval '25 days', now() - interval '18 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client1@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 8. Card reader in reception won't pair — client2, open
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000008', 'Card reader in reception won''t pair', 'The card reader on the reception desk will not pair with the tablet that replaced the old till.',
       'hardware', 'medium', 'open',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '3 days', now() - interval '2 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client2@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 9. Website contact form is silently failing — client2, in_progress, escalated
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000009', 'Website contact form is silently failing', 'Enquiries submitted through the website contact form never arrive. The form itself reports success.',
       'software', 'critical', 'in_progress',
       c.id, a.id,
       now() - interval '4 days',
       a.parent_id,
       null,
       now() - interval '5 days', now() - interval '4 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client2@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- 10. Revoke access for a leaver — client2, resolved
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select '10000000-0000-4000-8000-000000000010', 'Revoke access for a leaver', 'Our warehouse supervisor left on Friday and still has access to everything.',
       'access', 'low', 'resolved',
       c.id, a.id,
       null,
       null,
       null,
       now() - interval '12 days', now() - interval '11 days'
from public.users c
join public.users a on a.id = c.parent_id
where c.email = 'client2@email.com'
on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;

-- --------------------------------------------------------------------------
-- Conversations
-- --------------------------------------------------------------------------

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000000001', u.id, 'client',
       'Laptop won''t get past the manufacturer logo since Tuesday''s update. Safe mode does nothing either. Payroll runs Friday, so this is urgent.', 'message', now() - interval '6 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000001002', '10000000-0000-4000-8000-000000000001', u.id, 'agency',
       'We have tried a safe-mode boot and rolling the update back, and neither took. The drive may be failing. Escalating to the platform admin for a hardware call.', 'message', now() - interval '5 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000001003', '10000000-0000-4000-8000-000000000001', u.id, 'admin',
       'Picked this up. A replacement drive is on its way to you for Thursday, and the last backup restored cleanly on our bench, so nothing should be lost.', 'message', now() - interval '3 days'
from public.users u
where u.email = 'admin1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000002001', '10000000-0000-4000-8000-000000000002', u.id, 'client',
       'The shared drive disconnects several times a day for everyone. It reconnects on its own after a minute but people are losing work in between.', 'message', now() - interval '2 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000002002', '10000000-0000-4000-8000-000000000002', u.id, 'client',
       'Three more times since yesterday. Is anyone able to look at this today?', 'message', now() - interval '1 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000003001', '10000000-0000-4000-8000-000000000003', u.id, 'client',
       'New account manager starts Monday. They need the CRM and the shared inbox their team works out of.', 'message', now() - interval '4 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000003002', '10000000-0000-4000-8000-000000000003', u.id, 'agency',
       'CRM account is created and waiting on first sign-in. Which shared inbox did you mean, sales or support? Either way we need their manager to confirm in writing.', 'message', now() - interval '3 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000004001', '10000000-0000-4000-8000-000000000004', u.id, 'client',
       'The panel outside the big meeting room is a week behind, so people keep walking in on meetings that were booked properly.', 'message', now() - interval '9 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000004002', '10000000-0000-4000-8000-000000000004', u.id, 'agency',
       'It is a known sync fault between the panel firmware and the room calendar. The vendor has a fix in their next release at the end of the month, so we are parking this until then rather than reimaging it twice.', 'message', now() - interval '8 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000005001', '10000000-0000-4000-8000-000000000005', u.id, 'client',
       'Month-end invoice export runs and downloads, but all 40 PDFs in it are empty. We cannot send any of them out.', 'message', now() - interval '14 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000005002', '10000000-0000-4000-8000-000000000005', u.id, 'agency',
       'Reproduced it. The export server had filled its disk, so every PDF was written empty without erroring. Cleared it, added an alert at 80%, and re-ran your export.', 'message', now() - interval '13 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000005003', '10000000-0000-4000-8000-000000000005', u.id, 'client',
       'All 40 came through properly. Thanks for the quick turnaround.', 'message', now() - interval '11 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000006001', '10000000-0000-4000-8000-000000000006', u.id, 'client',
       'Everyone working from home is dropped off the VPN every five to ten minutes. It is unusable for calls.', 'message', now() - interval '20 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000006002', '10000000-0000-4000-8000-000000000006', u.id, 'agency',
       'Updated the firmware on our side and rebuilt the tunnel config. It has held for 24 hours here without a drop.', 'message', now() - interval '18 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000006003', '10000000-0000-4000-8000-000000000006', u.id, 'client',
       'It was fine for a fortnight and then started again yesterday. Three people dropped mid-call this morning, so it is not fixed.', 'reopen', now() - interval '1 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000007001', '10000000-0000-4000-8000-000000000007', u.id, 'client',
       'No phone in the office has pulled new mail since Saturday. Desktops are fine, so people are stuck at their desks.', 'message', now() - interval '25 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000007002', '10000000-0000-4000-8000-000000000007', u.id, 'agency',
       'The mail server accepts desktop clients and rejects mobile ones, which points at the mobile gateway rather than anything on your side. Escalating — that gateway is not ours to configure.', 'message', now() - interval '24 days'
from public.users u
where u.email = 'agency1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000007003', '10000000-0000-4000-8000-000000000007', u.id, 'admin',
       'The certificate on the mobile gateway had expired. Renewed it and pushed the new one out; phones should sync within the hour.', 'message', now() - interval '23 days'
from public.users u
where u.email = 'admin1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000007004', '10000000-0000-4000-8000-000000000007', u.id, 'client',
       'All syncing again. Thanks both.', 'message', now() - interval '18 days'
from public.users u
where u.email = 'client1@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000008001', '10000000-0000-4000-8000-000000000008', u.id, 'client',
       'The card reader on reception will not pair with the new tablet. It pairs with a phone fine, so the reader itself seems alive.', 'message', now() - interval '3 days'
from public.users u
where u.email = 'client2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000008002', '10000000-0000-4000-8000-000000000008', u.id, 'client',
       'Tried the reset pinhole and a fresh pairing code, no change. We are taking payments on the old machine meanwhile.', 'message', now() - interval '2 days'
from public.users u
where u.email = 'client2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000009001', '10000000-0000-4000-8000-000000000009', u.id, 'client',
       'Nothing from the website contact form has reached us this week, but the form still says "thanks, we will be in touch". We think we have lost a week of enquiries.', 'message', now() - interval '5 days'
from public.users u
where u.email = 'client2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000009002', '10000000-0000-4000-8000-000000000009', u.id, 'agency',
       'The form posts correctly — the mail relay is refusing our domain, which is why it fails quietly. Escalating, as the relay is not ours to configure.', 'message', now() - interval '4 days'
from public.users u
where u.email = 'agency2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000010001', '10000000-0000-4000-8000-000000000010', u.id, 'client',
       'Our warehouse supervisor left on Friday. Please revoke everything and let us know what they still had access to.', 'message', now() - interval '12 days'
from public.users u
where u.email = 'client2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select '20000000-0000-4000-8000-000000010002', '10000000-0000-4000-8000-000000000010', u.id, 'agency',
       'Account disabled and all sessions revoked. They held the stock system, the shared drive and the office wifi certificate, which has been rotated. Mailbox forwards to the office manager for 30 days and then closes.', 'message', now() - interval '11 days'
from public.users u
where u.email = 'agency2@email.com'
on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;

-- Replies added by hand to a seeded ticket, from an earlier run or from using
-- the app. Cleared so a re-seed puts these threads back exactly as documented.
delete from public.ticket_messages
where ticket_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000010')
  and id not in ('20000000-0000-4000-8000-000000001001', '20000000-0000-4000-8000-000000001002', '20000000-0000-4000-8000-000000001003', '20000000-0000-4000-8000-000000002001', '20000000-0000-4000-8000-000000002002', '20000000-0000-4000-8000-000000003001', '20000000-0000-4000-8000-000000003002', '20000000-0000-4000-8000-000000004001', '20000000-0000-4000-8000-000000004002', '20000000-0000-4000-8000-000000005001', '20000000-0000-4000-8000-000000005002', '20000000-0000-4000-8000-000000005003', '20000000-0000-4000-8000-000000006001', '20000000-0000-4000-8000-000000006002', '20000000-0000-4000-8000-000000006003', '20000000-0000-4000-8000-000000007001', '20000000-0000-4000-8000-000000007002', '20000000-0000-4000-8000-000000007003', '20000000-0000-4000-8000-000000007004', '20000000-0000-4000-8000-000000008001', '20000000-0000-4000-8000-000000008002', '20000000-0000-4000-8000-000000009001', '20000000-0000-4000-8000-000000009002', '20000000-0000-4000-8000-000000010001', '20000000-0000-4000-8000-000000010002');

-- --------------------------------------------------------------------------
-- Read state
--
-- Which is what decides where an unread badge appears. Everyone who can see a
-- ticket is marked caught up except where a badge is wanted — without this,
-- every ticket would badge for everybody (no row means never opened) and
-- nothing resolved would collapse into the archive, since an unread reply keeps
-- a ticket out of it.
-- --------------------------------------------------------------------------

-- 1. read by client1, agency1 — unread for admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000001', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'agency1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 2. read by client1, admin1 — unread for agency1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000002', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 3. read by agency1, admin1 — unread for client1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000003', u.id, now()
from public.users u
where u.email in ('agency1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 4. read by client1, agency1, admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000004', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'agency1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 5. read by client1, agency1, admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000005', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'agency1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 6. read by client1, admin1 — unread for agency1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000006', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 7. read by client1, agency1, admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000007', u.id, now()
from public.users u
where u.email in ('client1@email.com', 'agency1@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 8. read by client2, admin1 — unread for agency2
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000008', u.id, now()
from public.users u
where u.email in ('client2@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 9. read by client2, agency2 — unread for admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000009', u.id, now()
from public.users u
where u.email in ('client2@email.com', 'agency2@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

-- 10. read by client2, agency2, admin1
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select '10000000-0000-4000-8000-000000000010', u.id, now()
from public.users u
where u.email in ('client2@email.com', 'agency2@email.com', 'admin1@email.com')
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000001'
  and user_id in (select id from public.users where email = 'admin1@email.com');

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000002'
  and user_id in (select id from public.users where email = 'agency1@email.com');

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000003'
  and user_id in (select id from public.users where email = 'client1@email.com');

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000006'
  and user_id in (select id from public.users where email = 'agency1@email.com');

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000008'
  and user_id in (select id from public.users where email = 'agency2@email.com');

delete from public.ticket_reads
where ticket_id = '10000000-0000-4000-8000-000000000009'
  and user_id in (select id from public.users where email = 'admin1@email.com');

-- Drop any sessions these accounts already held, so a re-seed forces a fresh
-- sign-in rather than leaving a stale token pointing at the old row.
delete from public.sessions
where user_id in (select id from public.users where email in ('admin1@email.com', 'agency1@email.com', 'agency2@email.com', 'client1@email.com', 'client2@email.com'));

-- Internal Ticket System — wipe everything.
--
-- DESTRUCTIVE. This empties every table: all accounts, all tickets, all
-- conversations, all sessions. There is no undo and nothing is exported first.
-- It exists for one job — putting a development database back to nothing so
-- seed.sql can lay down a known state on top of it.
--
-- Usage, in the Supabase SQL editor:
--
--   1. this file      -- empties everything
--   2. seed.sql       -- the five test accounts and the demo tickets
--
-- schema.sql does NOT need re-running: this deletes rows, never tables, so
-- every type, constraint, index and RLS setting survives untouched.
--
-- Deliberately NOT part of seed.sql. Seeding is something you do often and
-- safely — it resets the seeded rows in place and leaves accounts you created
-- through the app alone. Folding a wipe into it would mean every routine
-- re-seed quietly destroyed whatever you were in the middle of testing.
--
-- Local development only. Never run this against anything with real data in it.

-- One statement, so it is all-or-nothing: a failure part way through cannot
-- leave tickets pointing at accounts that no longer exist.
--
-- `cascade` is what makes the order irrelevant. Deleting row by row would have
-- to go leaf-first — ticket_reads, then messages, then tickets, then sessions,
-- then clients before agencies before admins, because users_parent_fkey and
-- ticket_messages.author_id are both `on delete restrict` and would otherwise
-- refuse. Every table those constraints reach is named here anyway; `cascade`
-- only saves the ordering.
truncate table
  public.ticket_reads,
  public.ticket_messages,
  public.tickets,
  public.sessions,
  public.users
cascade;

-- Any browser still holding a session cookie now points at a row that is gone.
-- `attachUser` in server/session.js treats that as signed out and clears the
-- cookie on the next /api request, so there is nothing to tidy up by hand — the
-- next page load lands on the login form.

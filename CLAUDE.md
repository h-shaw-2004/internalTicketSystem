# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # production build to dist/
npm run preview      # serve the built output
npm test             # vitest, single run
npm run test:watch   # vitest in watch mode
```

Running a subset of tests:

```bash
npx vitest run shared/roles.test.js       # one file
npx vitest run -t "hashes a password"     # one test by name
```

There is no linter or formatter configured — don't invent an `npm run lint`.

## Setup

1. `cp .env.example .env` and set `DATABASE_URL` (Supabase → Project Settings → Database → Connection string → URI). The **server** reads it; nothing reaches the browser. `server/env.js` refuses to boot without it.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It is idempotent, so it is safe to re-run after edits.
3. Run `supabase/seed.sql` in the same editor for the test accounts (below). Also idempotent.
4. `npm run dev` starts **both** the API server (port 3001) and Vite (port 5173) via `concurrently`. `npm run dev:server` / `npm run dev:client` run them separately.

### Test accounts

```
admin1@email.com
├── agency1@email.com
│   └── client1@email.com
└── agency2@email.com
    └── client2@email.com
```

| Role | Email | Password | Parent |
|---|---|---|---|
| admin | `admin1@email.com` | `admin1Password?` | — |
| agency | `agency1@email.com` | `agency1Password?` | `admin1@email.com` |
| agency | `agency2@email.com` | `agency2Password?` | `admin1@email.com` |
| client | `client1@email.com` | `client1Password?` | `agency1@email.com` |
| client | `client2@email.com` | `client2Password?` | `agency2@email.com` |

Two branches on purpose: the admin's "browse by agency" picker needs something to pick between, and one agency must not be able to see the other's client or their tickets.

The `<name>Password?` shape satisfies every rule in `PASSWORD_RULES` — the digit in the account name is what meets the number requirement, so the password always carries the same number as the email. `scripts/generate-seed.mjs` runs `checkPassword` over each one and throws rather than emitting a seed that contradicts the policy the app enforces.

There is **no public sign-up**. Agencies are created by an admin and clients by an agency, so the first admin has to come from the SQL editor — that is the only channel that reaches the database directly &mdash; the browser cannot create accounts of any kind except through the API.

`supabase/seed.sql` is **generated** — edit `scripts/generate-seed.mjs` and run `npm run seed`, don't hand-edit the SQL. The hashes must be precomputed in Node because pgcrypto has no PBKDF2 and cannot produce the format `shared/password.js` expects. Regenerating produces new salts, so the file's diff churns every run; only regenerate when the accounts or the hashing parameters actually change.

Local development only — these passwords are trivially guessable.

**Never add a `VITE_`-prefixed database variable.** Anything `VITE_`-prefixed is inlined into the JavaScript every visitor downloads. The browser has no database credentials at all now, and it must stay that way — it talks to `/api` and nothing else.

## Architecture

Three tiers, in one repo:

```
src/      React 18 + Vite SPA. Knows only about /api.
server/   Express API. The only thing with database credentials.
shared/   Domain logic both tiers import (roles, tickets, password, policy).
supabase/ schema.sql + generated seed.sql
```

**Supabase is a hosted Postgres and nothing more.** Its auto-generated PostgREST API is not used, `@supabase/supabase-js` is not a dependency, and the anon key appears nowhere. The server connects with `pg` over `DATABASE_URL` and the SQL is written by hand.

`shared/` exists because both tiers need the same rules — `creatableRole` decides account creation on the server *and* which link the header shows; `checkPassword` drives the live checklist *and* the server's validation. One definition, so they cannot drift. **Node ESM requires file extensions**, so imports of shared modules must be written `../../shared/roles.js`, not `../../shared/roles`.

### The auth boundary

`src/api/auth.js` is the single place the browser touches credentials or the `users` table. It exports exactly six functions — `login`, `logout`, `getCurrentUser`, `createAccount`, `listChildAccounts`, `setInitialPassword` — plus an `AuthError` carrying an optional `field` for form-level highlighting.

```
pages/ + components/  →  context/AuthContext  →  api/auth  →  lib/http  →  /api
                      ↘  api/auth (account creation) ↗
```

`AuthContext` carries **session state only** (`user`, `loading`, `login`, `logout`). Creating or listing accounts doesn't change who is signed in, so pages call `src/api/auth.js` directly for those rather than routing them through context.

That layering is what made the move to a real API cheap: only `src/api/auth.js` and `src/api/tickets.js` changed, the signatures stayed identical, and every page, guard and test above them was untouched. Preserve it — new data access belongs behind a module in `src/api/` calling the server, never a `fetch` in a component.

`src/lib/http.js` is the only place the browser touches the network. `createClient(ErrorClass)` builds a request function so each API module keeps its own error type while the pages carry on reading `.message` and `.field` exactly as before.

### The server is the security boundary

Every access rule is enforced in `server/`, against a session the caller cannot forge. Checks in `src/` are now **UX only** — they decide what to render, never what is permitted. Both layers exist on purpose: hiding a button the user may not press is good UX, and the server refusing it is the actual control.

When you add a rule, it must land in `server/` to be real. A check added only to a page is decoration.

Three habits the routes follow, worth keeping:

- **Identity comes from the session, never the body.** `createAccount` derives the new role from `req.user.role`; `POST /tickets` takes `agency_id` from the client's own `parent_id`. There is no field a caller can tamper with.
- **Reads and writes share one scoping function.** `loadVisible()` in `server/routes/tickets.js` decides what a role may see, and the status and escalate routes call it before writing, so a write can never reach a ticket a read could not.
- **Forbidden and missing look identical.** `loadVisible` throws the same 404 either way, so the API cannot be used to confirm another agency's ticket exists.

RLS is enabled on all five tables — `users`, `sessions`, `tickets`, `ticket_messages`, `ticket_reads` — with **no policies at all**. The server connects as the database owner, which RLS does not apply to; every other role — including the anon key Supabase still publishes — matches no policy and sees nothing.

### Sessions

Opaque 32-byte random hex token issued by `server/session.js`, stored in the `sessions` table with an 8-hour TTL and sent to the browser as an **httpOnly cookie** (`its_session`). Browser JavaScript cannot read it, so an XSS bug cannot steal the session — and the client handles no token at all. `attachUser` resolves it on every `/api` request and clears the cookie on expiry or a missing row. There is no refresh; sessions simply expire.

In development the Vite proxy makes `/api` same-origin, so the cookie needs no CORS or `SameSite=None` handling. Deploying the two tiers to different origins would.

**Only `login` creates a session.** `createAccount` deliberately does not — the creator stays signed in as themselves, and the new account signs in later with the password it was given.

### Tickets

Raised by a client, worked by that client's agency, escalated to the agency's admin when the agency can't resolve it.

`src/api/tickets.js` is the only place the browser touches the `tickets` table — same boundary rule as `auth.js`. Every function re-resolves the actor from the session rather than trusting a caller-supplied id, and scopes reads and writes to what that actor may see.

`shared/tickets.js` holds the vocabulary and the permission predicates. **Its enum values mirror the Postgres types exactly** — changing a value needs an `alter type … add value` migration, so treat them as fixed and reword only the labels.

- Status: `open`, `in_progress`, `with_client`, `on_hold`, `resolved`. Any status can move to any other; `STATUS_ORDER` is display order, not a state machine.
- Department: `hardware`, `software`, `network`, `access`, `other`.
- Urgency: `low`, `medium`, `high`, `critical`.

**Who sees what:**

| Role | Sees | Can do |
|---|---|---|
| client | tickets they raised | raise tickets |
| agency | tickets from their clients (`agency_id = self`) | change status, escalate once |
| admin | escalated queue (`escalated_to = self`), plus browse-by-agency | change status |

`tickets.agency_id` is copied from the client's parent at creation rather than joined through on read, so moving a client to a different agency leaves historical tickets with the agency that actually handled them.

**Escalation is a request for help, not a handover.** After escalating, the agency keeps working the ticket and both it and the admin can change the status. `canEscalate` is agency-only and returns false once `escalatedAt` is set — an admin has nobody above to escalate to. `tickets_escalation_check` enforces that `escalated_at` and `escalated_to` are set together or not at all.

`createTicket` takes no `client_id` or `agency_id`; both come from the session, so a ticket cannot be aimed at another agency. `getTicket` returns the same "could not be found" message for a missing id and a forbidden one, so it can't be used to probe for other agencies' tickets.

`withClients()` attaches the raising client with a second query rather than a PostgREST embed, because `tickets` has three foreign keys into `users` and the embed syntax gets ambiguous.

### Ticket conversations

Every ticket carries a thread in `ticket_messages`, between the client who raised it and the agency working it. `TicketChat` (`src/components/TicketChat.jsx`) renders it on `/tickets/:id` for anyone who can see the ticket.

**Reading and posting are scoped differently, on purpose.** Reads use `loadVisible` unchanged, so if you can see the ticket you can follow the conversation on it — that keeps an admin's browse-by-agency view useful for oversight. Posting narrows it with `canPostMessage(role, ticket, userId)` in `shared/tickets.js`:

| Role | Reads | Posts |
|---|---|---|
| client | their own tickets | always |
| agency | their clients' tickets | always |
| admin | escalated queue **and** browse-by-agency | **only once escalated to them** |

So an admin browsing an agency's tickets is a reader until escalation invites them in. The write can never reach a thread the read could not, because the post route runs `loadVisible` first and `canPostMessage` on top — the same "reads and writes share one scoping function" habit as the status and escalate routes, with a strictly narrower check added rather than a parallel rule.

`author_role` is **stored on the message**, not joined from `users`. Same reasoning as `tickets.agency_id` being copied at creation: promoting an account must not silently rewrite how its old messages are attributed.

Posting bumps `tickets.updated_at` in the same statement as the insert (a data-modifying CTE), so a reply counts as activity on the ticket and a message can never be stored without the timestamp moving with it.

**Resolving closes the conversation.** `isConversationOpen(ticket)` is false once the status is `resolved`, and `canPostMessage` refuses on it for *every* role. Without that, a resolved ticket stays a live inbox: any message raises an unread badge, and because unread pulls a ticket back out of the archive, chatting quietly becomes a second way to reopen work — one that leaves the status reading "resolved" while the ticket sits in the active list. There is exactly one way back, `canReopen`, which asks for a reason and actually moves the status. Reopening reopens the conversation with it.

The thread stays **readable** — the history is the point, and an agency's last word before resolving is often the most important message on the ticket. Only the composer goes, replaced by a line naming the way back. `refusalMessage()` in the route explains `canPostMessage`'s answer without becoming a second gate that could disagree with it.

The unread guard in `isArchived` still earns its place despite this: an agency can post and *then* resolve, leaving the client a genuinely unread message on a resolved ticket.

**The composer sits outside `<AsyncBoundary>`.** The boundary renders `empty` *instead of* its children, so a composer inside it would leave a client unable to send the first message — the state every new ticket starts in. `TicketChat` also merges optimistically-sent messages into the fetched list and promotes `empty` to `ready` when it does, so your own first message appears immediately instead of after the next poll. A test covers both.

**Polling, not websockets.** Threads are short and one small request every ten seconds per open ticket needs no connection handling, no reconnect logic and no server-side state. The trade accepted with it: an admin sitting on a ticket when it gets escalated does not gain a composer until they reload, because the chat polls messages and not the ticket. That was judged cheaper than polling both.

### Unread replies

Every ticket row carries a `{n} new` badge when somebody else has replied since you last opened it. `ticket_reads (ticket_id, user_id, last_read_at)` holds the state — **unread is a fact about a viewer, not about a ticket**, so it cannot be derived from `ticket_messages` alone. No row means never opened, which is exactly the right default.

Unread for a viewer is messages on the ticket where `author_id <> viewer` and `created_at > last_read_at`. Excluding your own authorship is what stops sending a reply from marking your own ticket unread.

**The count rides on the existing list query**, as `unread_count` — a list with badges still costs one request. That is why `TICKET_SELECT` became `ticketSelect(viewer)`: the argument is a *placeholder name* (`'$1'`), never a value, and it exists because `/by-agency/:agencyId` filters on an id that is not the viewer's, so the two cannot share a parameter position. Every other route passes `'$1'` for both. `count(*)` is cast `::int` because pg returns bigint as a string.

The same column serves all three roles with no extra logic — an agency sees unread on its clients' tickets and an admin on its escalated queue, because the rule is only ever "someone other than me wrote this".

`POST /tickets/:id/read` upserts, scoped by `loadVisible` like everything else. `TicketChat` calls it whenever the thread's **newest message changes**, not just on mount — a reply landing while you are reading would otherwise still be badged unread when you went back to the list. It is keyed on that timestamp so a poll that changes nothing costs no request, and a failed mark clears the key so the next poll retries.

The work queues on `/tickets` poll at 30s so a badge appears without a reload — slower than the conversation's 10s, since a reply landing on a list you are scanning is less urgent than one landing in a thread you are reading, and it refetches every ticket rather than one. **"Browse by agency" deliberately does not poll**: it is an ad-hoc oversight query, not a queue anyone sits in front of.

The badge is one of only two chips allowed to tint themselves (escalation is the other), and it carries a number, so it never depends on colour to be understood. `--accent-bg` / `--accent-border` were added for it, mirroring the existing danger and success pairs.

### The resolved archive

Resolved tickets collapse into a `<details>` section headed "Resolved (n)" beneath every list, for all three roles. **There is no `archived` column** — `status === 'resolved'` already carries that fact, and a second field that could disagree with it would only invent a question about which one wins. `isArchived(ticket)` in `shared/tickets.js` is the whole rule.

**Unread replies keep a ticket out of the archive.** Otherwise resolving something buries the conversation on it, and an agency writing to a resolved ticket would be talking into a drawer nobody opens.

**The split happens after the fetch, in `TicketResults`, not in the API.** `TicketSummary` derives every count from the list it is handed, so a server that filtered resolved tickets out would leave its Resolved tile reading 0 forever and quietly falsify the "costs no extra request" claim in its docstring. The whole list still reaches the summary; only the tables are split. A test asserts the counts survive.

Collapsing, not hiding: a client who thinks the problem *isn't* fixed still has to reach the ticket to say so.

**`hasOpenEscalation(ticket)` is the difference between "this happened" and "this is still true".** `escalated_at` is never cleared — it records what a ticket went through, so on its own it stays true forever. Three places read it:

- **`TicketSummary`'s Escalated tile** counts `hasOpenEscalation`, not `escalatedAt`. Counting it raw kept resolved tickets in a red count that read as work still owed by an admin. The tile means *outstanding*, like the status tiles beside it. The Resolved tile is the terminal one and does count everything.
- **The row badge** (`TicketTable`) and **the detail badge** drop from `badge-escalated` to `badge-escalated-past` once resolved — same label, same pill, muted instead of danger-tinted, with a title saying it was escalated *before* it was resolved. A finished escalation is a record, not an alarm.

Reopening restores all three to loud, for free, because status goes back to `open`.

`.badge-escalated` does double duty as a `markClass` on the summary mark, which is why the quiet variant is a separate class rather than an override of it.

### Reopening — a client refusing a resolution

`POST /tickets/:id/reopen` moves `resolved` back to `open` and posts the client's reason into the thread, in one data-modifying CTE so a ticket can never come back with no explanation on it.

**It is its own route, not a widening of `PATCH /:id/status`.** That route keeps `requireRole(ROLES.AGENCY, ROLES.ADMIN)` untouched, so a client gets exactly one transition and never the whole status dropdown. `escalate` is the same shape pointed the other way down the hierarchy, and was the template.

`canReopen(role, ticket, userId)` is the client who raised it, on a resolved ticket. **Deliberately unlimited** — `canEscalate` is once-only because escalation climbs a finite hierarchy, but a genuinely unfixed problem can legitimately come back twice, and a client out of reopens has no route left inside the app.

The reason is **mandatory**: "it isn't fixed" with nothing after it gives the agency nothing to pick up. Because it lands as a message, the agency finds out through the unread badge — no separate notification path exists or is needed.

Reusing `open` rather than adding a `reopened` status is deliberate: a new enum value needs an `alter type` migration and then ripples into `STATUS_ORDER`, `STATUS_LABELS`, a sixth summary tile, a badge colour, and a new option agencies could set directly. The cost is that a reopened ticket is indistinguishable from a fresh one in the status column — the history lives in the thread. Revisit only if disputes ever need counting or filtering.

**A reopen is visible as an event, not just as a message.** Two things record it:

- `ticket_messages.kind` — `'message'` or `'reopen'`, set on the reason row. `TicketChat` renders a `reopen` row as an event (accent block, "Reopened this ticket", a byline, then the reason) instead of an attributed reply. It is **text plus a check constraint, not a Postgres enum**, deliberately: the set will grow, and widening a check constraint is a drop-and-add in `schema.sql` whereas `alter type … add value` is a migration that cannot be rolled back in a transaction. `MESSAGE_KINDS` in `shared/tickets.js` mirrors it, and a test asserts the two agree.
- `tickets.reopened_at` — genuinely new information rather than a duplicate of `status`, since an open ticket that came back is not the same as one nobody has looked at. Mirrors `escalated_at`, is never cleared, and drives `isReopened(ticket)` and the list's accent **Reopened** badge. Gated on status exactly like `hasOpenEscalation`, so it quietens once resolved again.

The badge is accent rather than danger: reopened work wants noticing because it is usually a quick fix somebody has already been inside, not because anything has gone wrong.

Reopening composes with the archive for free: status becomes `open`, so the ticket leaves the collapsed section on both sides with no extra bookkeeping. That is the main reason the archive is a view filter rather than stored per-user dismissal state — a dismissal would have needed un-dismissing too.

`TicketChat` takes a `reloadKey` so the page can force a refetch when something outside the chat writes to the thread. Reopening is the only caller today; waiting out the ten-second poll to show your own reason looks broken.

### The ticket detail page on a phone

Two changes, both pure CSS below 640px, both chosen over a `<details>` disclosure — Chrome 131+ wraps details content in `::details-content` with `content-visibility: hidden`, so the usual "force it open again on desktop" trick no longer works.

**The metadata grid becomes an inline strip.** Six facts stacked label-above-value is a dozen rows between the subject and the conversation. Each `dt`/`dd` pair is wrapped in a `div` so a label can never end up on a different line from its value; `.detail-grid > div { display: contents }` hands them back to the grid at desktop widths, so the two-column layout is byte-for-byte what it was. Nothing is hidden.

**The panels reorder**: ticket → conversation → actions → reopen, via `order` on `.panel-ticket` / `.panel-conversation` / `.panel-actions` / `.panel-reopen`. Reading the thread is the common reason to open a ticket; changing a status or reopening is a deliberate act you scroll to. They are direct children of `.app-main-stack` because the fragment `AsyncBoundary` returns creates no element — if that ever gains a wrapper, `order` stops working. A test asserts the class names, since jsdom cannot see the ordering itself.

**The conversation is deliberately not moved above the ticket panel.** The `<h1>` only says "Ticket"; the subject is an `<h2>` inside that panel, so leading with messages would strand you with no idea which ticket they belong to.

### Async states — required, not optional

A brief requirement: **every list and every fetch needs loading, empty and error designed, not just the happy path.** An empty list and a failed one must never render as the same blank rectangle.

Use `useAsync` (`src/lib/useAsync.js`) with `<AsyncBoundary>` (`src/components/AsyncBoundary.jsx`) for any list or fetch. The hook reports one of `loading | empty | error | ready` (plus `idle` when disabled), deriving **empty as part of the state machine** rather than as a branch a caller can forget, and `AsyncBoundary` makes `empty` a *required* prop for the same reason.

`useAsync`'s `task` is the effect dependency, so it must be stable — wrap it in `useCallback`. An inline arrow re-fetches on every render.

- **Loading** — no layout shift when content lands; don't flash it for fast responses.
- **Empty** — say why it's empty and what to do next. "No results for this filter" is a different screen from "nothing here yet"; the latter carries the call to action.
- **Error** — a human sentence plus a **retry that re-runs the fetch**, not a page reload.

`useAsync(task, { pollMs })` re-runs on an interval, and those re-runs are deliberately **not** the same as the first fetch. A background refresh never sets `loading` (so the view doesn't blink) and never clears the data on failure — it sets `stale` and leaves the last good result up, because losing a conversation you were reading beats showing it slightly behind. Only the foreground fetch may replace the screen with an error. Polls also pause while the tab is hidden, fire once on return, and never stack behind a slow response. `refresh()` triggers one by hand; `retry()` is still the foreground reload.

Whole-screen failures use `FullPageError` (`title`, `message`, optional `detail`, optional `onRetry`). `detail` is raw and must stay behind `import.meta.env.DEV`.

Two failure modes are already handled centrally, and both were real bugs — don't undo them:

- **`AuthProvider` keeps `bootstrapError` separate from `user === null`.** A failed session lookup is *not* being signed out. Collapsing them dumps a valid session at `/login` with no explanation and makes every network blip look like an auth bug. The provider renders `FullPageError` with a retry instead of rendering routes.
- **`ErrorBoundary` wraps the root** in `src/main.jsx`, so a render-time throw shows a real screen instead of a blank white page. (The browser no longer has any configuration to get wrong — that check moved to `server/env.js`, which fails at boot with a message naming the fix.)

**Still deferred:** skeleton rows for tables — loading is plain text today — and a retro-fit of the `Accounts` list onto `useAsync`, since its three branches are hand-rolled with no retry and thin empty copy. The three route guards also duplicate the same `route-status` markup and should collapse into a shared component.

### Passwords

`shared/password.js` — PBKDF2-SHA256, 210,000 iterations, over the Web Crypto API. The stored format is `pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>`; the iteration count is read back from the string, so raising `ITERATIONS` doesn't invalidate existing hashes. Web Crypto was chosen over a library because Node exposes the same interface, so the server runs it unchanged. Comparison is timing-safe.

### Roles

`client` → `agency` → `admin`, ascending. `hasRole(role, required)` is **inclusive of everything above** — `hasRole('admin', 'agency')` is true.

### Account hierarchy

```
admin
  └── agency      parent = an admin
        └── client    parent = an agency
```

Each account has exactly one parent, which is what makes "a client has one agency" and "an agency has one admin" structural rather than conventional. `users.parent_id` plus `users.parent_role` carry it.

**`parent_role` duplicates the parent's role on purpose.** It is what lets the composite foreign key `(parent_id, parent_role) → users(id, role)` assert *what kind* of account the parent is, so "an agency's parent must be an admin" is enforced by Postgres rather than by a trigger or by trusting the browser. `users_hierarchy_check` pins which parent role each role requires and that admins have none. A side effect worth knowing: demoting an agency that still has clients is rejected by the FK rather than silently orphaning them.

`creatableRoles(role)` in `shared/roles.js` is the single source of truth for who creates whom:

| Actor | May create | Parent of the new account |
|---|---|---|
| admin | agency | the admin |
| admin | **client** | **a chosen agency of that admin** |
| agency | client | the agency |
| client | — | — |

**Nothing maps to `admin`**, so no account is mintable through the API at any privilege level; `roles.test.js` asserts that for every role.

An admin creating a client must name the agency, because `users_hierarchy_check` requires a client's parent to be an agency — the admin cannot own one directly. `needsAgencyChoice(actorRole, targetRole)` is true only for that one combination.

`createAccount` accepts `role` now that an admin has a choice, but the server checks it with `canCreateRole` against the **session's** role, so the widening is "which of my permitted roles", never "any role". `agencyId` is read only when `needsAgencyChoice` holds and must be an agency owned by the caller; for an agency it is ignored entirely, since an agency *is* the parent. Verified against the live database: an agency passing another agency's `agencyId` still gets its own client.

`GET /accounts` returns direct children for an agency, and for an admin **also the grandchildren** — an admin can create a client whose parent is an agency, so direct children alone would hide it the moment it was made. Each row carries `parent` so the table can show which agency a client belongs to.

### Temporary passwords and forced first change

`createAccount` takes **no password either** — it generates one, and returns `{ account, temporaryPassword }`. That plaintext crosses the API boundary exactly once, is shown to the creator in a callout on `/accounts`, and is never recoverable afterwards. The creator therefore never learns the password the account ends up with.

Because that handover is the one moment that matters, the callout carries a **`CopyButton`** on each of the two values — retyping a generated password by hand is where it goes wrong. It is local to `Accounts.jsx` rather than shared, since nothing else hands over a secret.

The Clipboard API needs a **secure context**, so its absence is a normal outcome rather than a bug: the button falls back to "Select it instead" and the value keeps its `user-select: all`. Note `navigator.clipboard?.writeText(…)` alone is not a sufficient guard — optional chaining makes the whole call evaluate to `undefined`, which `await`s happily and would report a success that never happened. The check is explicit for that reason, and a test covers both the missing-API and rejected-promise paths.

New accounts carry `users.must_change_password`. While it is set:

- `ProtectedRoute` redirects every protected route to `/set-password`.
- `/set-password` is guarded by `PasswordSetupRoute` instead, which requires the flag to be set and sends settled accounts to `/tickets`. **The two guards are deliberate mirror images** — that is what stops them redirecting into each other. Don't put `/set-password` behind `ProtectedRoute`.

`setInitialPassword` refuses to run unless the flag is set, so it cannot double as a password reset for an established account. It does **not** ask for the current password: the session token is the proof of identity and the user typed the temporary password moments earlier. It deletes the account's *other* sessions on success, keeping the one making the change.

After it succeeds the page must call `AuthContext.refresh()` before navigating, or the guards still see the stale flag and bounce straight back.

Seeded accounts have `must_change_password = false` so their documented credentials keep working. To exercise the flow, create an account through the UI.

### Password policy

`shared/passwordPolicy.js` owns both the rules and the generator. `PASSWORD_RULES` is a single array consumed by the live checklist on `/set-password` *and* by the check inside `setInitialPassword`, so the feedback and the enforcement cannot drift apart. Add rules there, nowhere else.

`MIN_LENGTH` is **10**, inclusive — a 10-character password passes. One constant to change if that moves.

On `/set-password` the two password boxes sit directly above one another and the requirements checklist sits **below both**, describing them jointly. A test asserts that ordering, so moving the list back up between the fields will fail.

`generatePassword()` satisfies the policy by construction (one character from each required set, remainder from all, then shuffled). It draws from `crypto.getRandomValues` with rejection sampling rather than `% n`, which would bias towards low indices. Ambiguous glyphs (`0 O 1 l I`) are excluded from every set because these passwords get read off a screen and typed by hand.

### Navigation on small screens

**The desktop design is unchanged.** Above 900px the header carries the title, identity, page actions and sign-out exactly as it always did, there is no sidebar, and `AppNav` plus the menu button are `display: none`. Anything that alters the desktop layout is a regression, not a feature.

Below 900px the header keeps only the menu button and the title, and `AppNav` (`src/components/AppNav.jsx`) is a drawer over a scrim holding identity, the destinations and sign-out. 900 rather than the 640 used elsewhere: at 640 a portrait tablet's header is already too cramped to hold the actions, so tablets get the drawer too. Those are the only two breakpoints.

`open` lives in `AppHeader` because the button that sets it is a header control, while the drawer is a full-page overlay rendered as a *sibling* of `<header>` — a fixed panel covering the viewport has no business inside the banner landmark, and nesting it there also makes `within(getByRole('banner'))` useless for telling the two apart in tests.

Everything modal — the scroll lock, the focus trap, `aria-modal`, `role="dialog"` — is **gated on `open`**, so nothing is announced as a dialog when the drawer is merely off-canvas. A `matchMedia` listener closes it on resize past the breakpoint, or the scroll lock would stay applied to a page with no drawer on it.

**The links are plain `Link`s, not `NavLink`s.** `Tickets` and `Resolved` are the same route with different search params; `NavLink` matches on pathname only *and* sets its own `aria-current`, which won over ours — so on `/tickets?view=resolved` both items were marked as the current page. `isCurrent()` compares the `view` param explicitly. A test covers it.

**Resolved work stays a collapsed `<details>` at the foot of the list — that is the desktop design and it stays that way** (`.wide-only`). Below 900px that section is hidden and a **segmented Open / Resolved control** (`.narrow-only`) sits above the table instead, switching `?view=resolved`. Same tickets, same fetch, two presentations; `TicketResults` branches on `resolvedView` for that reason and no other.

Resolved is **not** a drawer item, and putting it back would be a regression. It is a filter of one list, and sitting it beside "Raise a ticket" and "Accounts" styled identically to them made a sub-view look like a fourth destination. The segmented control says what it actually is and shows **both counts at once**, which two nav links could never do. It renders only on the primary queue — never on the admin's browse-by-agency panel, where a second identical control driving the same URL would be nonsense.

There is deliberately **no Resolved toggle in the desktop header** — the archive underneath the table is the way in, as it always was.

`.narrow-only` is the mirror of `.wide-only`, at the same 900px line.

**`backTo` marks a page as a sub-page and is the single declaration of where "back" goes.** `AppHeader` renders it twice from that one prop: the desktop **Back to tickets** button in the actions row, and — below 900px — a back chevron *in place of* the menu button. `TicketDetail` passes the `location.state.from` path, so the chevron preserves an admin's `?agency=` selection exactly as the desktop button does; `NewTicket` and `Accounts` pass `/tickets`.

One control rather than two, because a sub-page has nothing to navigate to that its back destination does not also reach. **The trade, accepted deliberately:** the drawer cannot be opened from a sub-page, so signing out from `/accounts` on a phone is back-then-menu. Two controls competing for the top-left corner is worse.

The chevron's accessible name is **"Back"**, not "Back to tickets" — it is an icon control, the button beside it carries the long form, and identical names would make the two indistinguishable in jsdom, where both are always present.

Anything the drawer already carries is marked `.wide-only` at the call site rather than hidden by a blanket selector, so it stays obvious *why* a control disappears on a phone. The client list's "Raise a ticket" button is the one user of it — which is why that list's empty state carries its own inline link instead of pointing at a button that is not there.

Known trade: `.header-actions` is hidden below 900px, so `TicketDetail`'s "Back to tickets" is not shown on a phone; the drawer's Tickets item covers it, at the cost of dropping an admin's `?agency=` selection.

The drawer closes four ways — its own × button, the scrim, Escape, and navigating. The × exists because neither tapping away nor Escape is discoverable on a touch screen. Nav links and sign-out are 44px tall, and the drawer pads for `env(safe-area-inset-*)` so a notched phone does not clip it.

**Neither the close-on-navigate nor the focus-return effect may fire on mount.** Both are guarded by refs. Closing on mount wrote state on every page load for a drawer that was never open, and returning focus on mount stole it to the menu button on every page — the extra render that caused was enough to break an unrelated Accounts test that was awaiting a heading rather than the row it then queried.

**Two grid/flex traps caused horizontal scrollbars on phones, and both are easy to reintroduce.** A bare `1fr` is `minmax(auto, 1fr)` and refuses to shrink below its content's min-content width, so one unbreakable value (an email) pushes the whole page sideways — `.detail-grid` uses `minmax(0, 1fr)` at both widths for that reason. Flex items default to `min-width: auto` for the same reason, which is what `.app-main-stack > * { min-width: 0 }` fixes. If a page scrolls sideways on a phone, look for those two before anything else.

**The Accounts tables move the email under the name instead of dropping it.** Email is the widest column *and* the one that cannot go — it is the account's identity and what "Password not set" refers to — so dropping the cheap column alone still overflowed. Below 640px `.col-secondary` hides the Email and Created columns and `.cell-sub` reveals the address under the name, leaving Account + Status (and Clients on the admin's agencies table).

`.cell-sub` is `display: none` by default and revealed **in the very block that hides `.col-secondary`**, so the two can never both show and the address is never on screen twice. That pairing is why it is not a general utility class — a `.narrow-only`-style class at 900px would have left both visible between 641 and 899px.

The cost is that each row carries its email twice in the DOM. Only one is ever in the accessibility tree, but jsdom applies no CSS, so tests locating a row by email use `getAllByText(...)[0]` — both copies are in the same row, so either serves.

**The ticket table narrows to a single column, and loses nothing.** Below 640px `.col-secondary` drops every column but Subject, and the subject cell carries them all back:

- `.cell-state` — status and urgency, keeping their **chip and their weight** rather than becoming sentence text. The status dot and the urgency's emphasis are the fastest things in a row to scan by; flattening them into the muted line would throw that away.
- `.cell-sub` — client, department and date, as one muted line.

It is still a real table with real rows: the semantics survive because the columns are hidden, not because the rows were turned into `display: block` cards.

**The actual cause of the sideways scroll was `white-space: nowrap` on every cell**, not the column count. A subject could never wrap, so the table stayed as wide as its longest one however many columns were dropped. Below 640px cells wrap and align to the top; chips keep their own `nowrap` so they stay intact. If a table ever scrolls sideways again, check that before counting columns.

Faking cards with `display: block` on rows would throw away the row and column semantics a screen reader relies on, which is not a trade this codebase makes anywhere.

The sub-line **joins its three values into one string** (`Client · Department · Date`) rather than rendering separate nodes. That is deliberate: an exact-text query like `getByText('Hardware')` then still matches only the real cell, so the duplication costs no test churn — unlike the Accounts tables, where the email is its own exact string in both places and lookups need `getAllByText(...)[0]`.

**Duplicate selectors are how this file breaks.** The mobile overrides live in a `@media (max-width: 899px)` block that relies purely on source order — a media query adds no specificity — so a second copy of `.header-actions` appearing later in the file silently re-showed sign-out at the top of every phone screen. `grep -oE "^\.[a-z-]+ \{" src/index.css | sort | uniq -d` catches it; the only legitimate repeats are `.auth-card`, `.notice` and `.summary-row`, which appear once for animation and once for layout.

Tests live in `src/components/AppNav.test.jsx`. **jsdom applies no CSS**, so the desktop/drawer split is not observable and every element is findable regardless of media queries — which is why page tests that query for things the drawer also carries (`Raise a ticket`, `Accounts`) scope to `within(screen.getByRole('main'))`, and header tests scope to `within(screen.getByRole('banner'))`.

### Routing

`src/App.jsx` holds the whole route table: `/login`, `/set-password`, `/tickets`, `/tickets/new`, `/tickets/:id`, `/accounts`. `/tickets` carries two search params — `?view=resolved` for the resolved list and `?agency=` for an admin's picker — rather than having routes of their own. **There is no `/register`** — it was removed when sign-up became top-down. Three guards wrap route elements:

- `ProtectedRoute` — requires a session; optional `requiredRole` prop, redirects to `/tickets` if the role is too low. `/accounts` uses `requiredRole={ROLES.AGENCY}`, which admits agencies and admins because the check is inclusive upward.
- `GuestRoute` — bounces signed-in users away from `/login`.
- `PasswordSetupRoute` — guards `/set-password` only; see the forced-change section above.

Both render a loading state while `AuthContext` resolves. `AuthProvider`'s `loading` starts `true` for this reason: without it, a signed-in user gets flashed to `/login` on first paint before the session resolves. Keep that invariant if you touch the provider.

Unmatched paths redirect to `/tickets`, which then redirects to `/login` when signed out.

**`/tickets` is the landing page — there is no dashboard.** It was a placeholder listing what your role could do, which the ticket views now show directly, so it was one click between signing in and the actual work. Its only unique feature, the "Manage accounts" link, moved into the tickets header. `TicketSummary` sits above every list, giving the at-a-glance counts a dashboard would have.

**The admin's chosen agency lives in the URL** (`/tickets?agency=<id>`), not in component state. Opening a ticket unmounts the list, so component state meant re-picking the agency after every single ticket. In the URL it survives the browser's back button *and* the page's own back link, and a filtered view becomes linkable. Written with `replace`, so trying three agencies doesn't leave three history entries to step back through.

`TicketTable` passes the list's full path and query as `location.state.from`, and `TicketDetail`'s "Back to tickets" returns there — guarded to a `/tickets` path so a stale or hand-edited history entry can only send you back into the list. **This is not the login redirect ruled out above**: it restores a list you were looking at seconds ago, not a destination across a change of account. Don't collapse the two.

**Signing in always lands on `/tickets`.** There is deliberately no "return to where you were" — `ProtectedRoute` carries no `location.state.from` and `Login` ignores any destination. The login form is most often used to *switch* accounts, and returning to the previous page drops the new user onto the previous one's screen, which may not even be theirs to see. A test in `Login.test.jsx` signs in after being bounced off a ticket detail URL and asserts it lands on the list. Don't reintroduce the redirect without handling the account-switch case.

On phones the six tiles become a **dense inline strip** — dot, label, count on one line each, wrapping — instead of two rows of cards. Same six figures including the zeros (so the row still does not reflow as work moves between states), about a fifth of the height, so tickets appear without scrolling past a block of counts.

`TicketSummary` is deliberately **not a chart** — five independent magnitudes with no trend and no part-to-whole story read faster as numbers. Counts derive from the tickets already fetched, so it costs no extra request. Colour repeats the table's status badge but is carried by a small mark, never the number text, so identity never depends on colour alone. Zero counts are shown rather than hidden, so the row doesn't reflow as work moves between states.

## Testing

Vitest with jsdom; config lives in the `test` block of `vite.config.js`, not a separate file. `globals: true`, so `describe`/`it`/`expect` need no import (existing tests import them from `vitest` anyway — follow the local file).

`src/test/setup.js` polyfills `crypto.subtle` from `node:crypto`, because jsdom ships `getRandomValues` but not `SubtleCrypto` and `shared/password.js` needs it. That gap is the test environment's alone — browsers provide it.

`src/App.test.jsx` is a smoke test: it renders the full tree and asserts the login form appears. A blank page in the browser is nearly always a render-time throw, and this catches it without opening a browser.

Page-level tests mock `../api/auth` (and `../api/tickets`) wholesale and drive the real `<App />`, setting the starting route with `window.history.pushState` before `render`. That exercises the actual guards and routing rather than a component in isolation, and keeps the tests off the network — the `src/api/` boundary is what makes a one-module mock sufficient. **Every test file rendering `<App />` must mock the api modules**, including the smoke test; without it `getCurrentUser` makes a real request and `AuthProvider` renders its error screen.

The 192 tests cover the React tier and `shared/`. **The `server/` routes still have no automated tests** — the highest-value gap in the project, and the chat raised the stakes: `canPostMessage` is unit-tested in `shared/`, but nothing yet asserts that the *route* consults it, so a leak there would surface as one tenant reading another's conversation rather than as a broken page. The unread query is in the same position — `unread_count` is computed only in SQL, so nothing catches it if the viewer parameter is ever wired to the wrong id. Both need a throwaway test database and an HTTP harness (`supertest`), neither of which exists yet.

Mocked API functions must `mockResolvedValue`, not bare `vi.fn()`, when the component chains off the returned promise — `markTicketRead(...).catch(…)` throws on a mock that returns `undefined`.

**React syncs a `<textarea>`'s value into its text content**, so an unscoped `findByText` for something the test typed will match the input box rather than the thing it was submitted into — and then fail with "element could not be found" when that box unmounts. Scope those queries (`within(await screen.findByRole('list'), …)`). This cost a debugging session on the reopen tests.

Chat tests using `pollMs` set `vi.useFakeTimers({ shouldAdvanceTime: true })` and advance with `await act(async () => vi.advanceTimersByTimeAsync(…))`. Plain fake timers deadlock against Testing Library's `findBy*`, which polls on its own timer.

`Accounts` loads its list in an effect, so tests must await the load settling (`await screen.findByText(/no … accounts yet/i)`) before asserting, or React emits `act()` warnings that bury real failures.

Query the login password box as `getByLabelText('Password')`, exactly. `PasswordField`'s show/hide toggle carries `aria-label="Show password"`, which `/password/i` also matches — the loose query finds two elements and throws.

## Environment note

Node here is v18.2.0. **Web Crypto is not a global in module files** on this version — it arrives by default in Node 19. Every entry point that touches `shared/password.js` therefore installs it:

| Entry point | Why |
|---|---|
| `server/env.js` | the API server |
| `scripts/generate-seed.mjs` | hashing seed passwords |
| `src/test/setup.js` | jsdom lacks `SubtleCrypto` |

**Do not "verify" this with `node -e`.** Node 18 exposes `globalThis.crypto` inside `-e` one-liners but *not* in `.js`/`.mjs` files, so a one-liner reports the global as present when the server would fail. Test with a real file. This cost a debugging session: without the polyfill every hash throws, `verifyPassword` returned false, and login reported "Email or password is incorrect" with nothing in the logs.

`shared/password.js` now derives **outside** its try/catch — only base64 decoding is tolerated, since a malformed stored hash is a genuine non-match while a missing crypto implementation is a broken environment that must surface loudly.

`node --watch` does not exist before Node 18.11, which is why `nodemon` runs the dev server.

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

RLS is enabled on all three tables with **no policies at all**. The server connects as the database owner, which RLS does not apply to; every other role — including the anon key Supabase still publishes — matches no policy and sees nothing.

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

### Async states — required, not optional

A brief requirement: **every list and every fetch needs loading, empty and error designed, not just the happy path.** An empty list and a failed one must never render as the same blank rectangle.

Use `useAsync` (`src/lib/useAsync.js`) with `<AsyncBoundary>` (`src/components/AsyncBoundary.jsx`) for any list or fetch. The hook reports one of `loading | empty | error | ready` (plus `idle` when disabled), deriving **empty as part of the state machine** rather than as a branch a caller can forget, and `AsyncBoundary` makes `empty` a *required* prop for the same reason.

`useAsync`'s `task` is the effect dependency, so it must be stable — wrap it in `useCallback`. An inline arrow re-fetches on every render.

- **Loading** — no layout shift when content lands; don't flash it for fast responses.
- **Empty** — say why it's empty and what to do next. "No results for this filter" is a different screen from "nothing here yet"; the latter carries the call to action.
- **Error** — a human sentence plus a **retry that re-runs the fetch**, not a page reload.

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

### Routing

`src/App.jsx` holds the whole route table: `/login`, `/set-password`, `/tickets`, `/tickets/new`, `/tickets/:id`, `/accounts`. **There is no `/register`** — it was removed when sign-up became top-down. Three guards wrap route elements:

- `ProtectedRoute` — requires a session; optional `requiredRole` prop, redirects to `/tickets` if the role is too low. `/accounts` uses `requiredRole={ROLES.AGENCY}`, which admits agencies and admins because the check is inclusive upward.
- `GuestRoute` — bounces signed-in users away from `/login`.
- `PasswordSetupRoute` — guards `/set-password` only; see the forced-change section above.

Both render a loading state while `AuthContext` resolves. `AuthProvider`'s `loading` starts `true` for this reason: without it, a signed-in user gets flashed to `/login` on first paint before the session resolves. Keep that invariant if you touch the provider.

Unmatched paths redirect to `/tickets`, which then redirects to `/login` when signed out.

**`/tickets` is the landing page — there is no dashboard.** It was a placeholder listing what your role could do, which the ticket views now show directly, so it was one click between signing in and the actual work. Its only unique feature, the "Manage accounts" link, moved into the tickets header. `TicketSummary` sits above every list, giving the at-a-glance counts a dashboard would have.

**Signing in always lands on `/tickets`.** There is deliberately no "return to where you were" — `ProtectedRoute` carries no `location.state.from` and `Login` ignores any destination. The login form is most often used to *switch* accounts, and returning to the previous page drops the new user onto the previous one's screen, which may not even be theirs to see. A test in `Login.test.jsx` signs in after being bounced off a ticket detail URL and asserts it lands on the list. Don't reintroduce the redirect without handling the account-switch case.

`TicketSummary` is deliberately **not a chart** — five independent magnitudes with no trend and no part-to-whole story read faster as numbers. Counts derive from the tickets already fetched, so it costs no extra request. Colour repeats the table's status badge but is carried by a small mark, never the number text, so identity never depends on colour alone. Zero counts are shown rather than hidden, so the row doesn't reflow as work moves between states.

## Testing

Vitest with jsdom; config lives in the `test` block of `vite.config.js`, not a separate file. `globals: true`, so `describe`/`it`/`expect` need no import (existing tests import them from `vitest` anyway — follow the local file).

`src/test/setup.js` polyfills `crypto.subtle` from `node:crypto`, because jsdom ships `getRandomValues` but not `SubtleCrypto` and `shared/password.js` needs it. That gap is the test environment's alone — browsers provide it.

`src/App.test.jsx` is a smoke test: it renders the full tree and asserts the login form appears. A blank page in the browser is nearly always a render-time throw, and this catches it without opening a browser.

Page-level tests mock `../api/auth` (and `../api/tickets`) wholesale and drive the real `<App />`, setting the starting route with `window.history.pushState` before `render`. That exercises the actual guards and routing rather than a component in isolation, and keeps the tests off the network — the `src/api/` boundary is what makes a one-module mock sufficient. **Every test file rendering `<App />` must mock the api modules**, including the smoke test; without it `getCurrentUser` makes a real request and `AuthProvider` renders its error screen.

The 72 frontend tests cover the React tier. **The `server/` routes have no automated tests yet** — the highest-value gap in the project.

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

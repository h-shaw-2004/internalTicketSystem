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
npx vitest run src/lib/roles.test.js      # one file
npx vitest run -t "hashes a password"     # one test by name
```

There is no linter or formatter configured — don't invent an `npm run lint`.

## Setup

1. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `src/lib/supabase.js` throws at import time if either is missing, which surfaces as a blank page.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It is idempotent (`if not exists` throughout, policies dropped before create), so it is safe to re-run after edits.
3. Run `supabase/seed.sql` in the same editor for the per-role test accounts (below). Also idempotent.

### Test accounts

| Role | Email | Password | Parent |
|---|---|---|---|
| admin | `admin@email.com` | `admin0Password?` | — |
| agency | `agency@email.com` | `agency0Password?` | `admin@email.com` |
| client | `client@email.com` | `client0Password?` | `agency@email.com` |

The `<role>0Password?` shape satisfies every rule in `PASSWORD_RULES`. `scripts/generate-seed.mjs` runs `checkPassword` over each one and throws rather than emitting a seed that contradicts the policy the app enforces.

There is **no public sign-up**. Agencies are created by an admin and clients by an agency, so the first admin has to come from the SQL editor — that is the only channel that bypasses RLS, and the insert policy refuses `role = 'admin'` from the browser outright.

`supabase/seed.sql` is **generated** — edit `scripts/generate-seed.mjs` and run `npm run seed`, don't hand-edit the SQL. The hashes must be precomputed in Node because pgcrypto has no PBKDF2 and cannot produce the format `src/lib/password.js` expects. Regenerating produces new salts, so the file's diff churns every run; only regenerate when the accounts or the hashing parameters actually change.

Local development only — these passwords are trivially guessable.

Every `VITE_`-prefixed variable is inlined into the browser bundle. Only the publishable/anon key belongs in `.env` — never the `sb_secret_` service-role key.

## Architecture

React 18 + Vite SPA. **Supabase is used as a database only** — its own auth stack is explicitly disabled in `src/lib/supabase.js` (`persistSession`, `autoRefreshToken`, `detectSessionInUrl` all false) so it never competes with the sessions this app issues itself.

### The auth boundary

`src/api/auth.js` is the single place the browser touches credentials or the `users` table. It exports exactly six functions — `login`, `logout`, `getCurrentUser`, `createAccount`, `listChildAccounts`, `setInitialPassword` — plus an `AuthError` carrying an optional `field` for form-level highlighting.

```
pages/ + components/  →  context/AuthContext  →  api/auth  →  lib/supabase
                      ↘  api/auth (account creation) ↗
```

`AuthContext` carries **session state only** (`user`, `loading`, `login`, `logout`). Creating or listing accounts doesn't change who is signed in, so pages call `src/api/auth.js` directly for those rather than routing them through context.

This layering is deliberate. Standing up the real API server means reimplementing `src/api/auth.js` as `fetch` calls and deleting the interim RLS policies in `supabase/schema.sql` — **no other file should need to change**. Preserve that property when adding features: new data access belongs behind a module in `src/api/`, not in a component.

### Current stage is not a security boundary

Auth checks run in the browser against the anon key. The interim RLS policies at the bottom of `supabase/schema.sql` grant `anon` broad read on `users`, unrestricted `update` on `users`, and full control of `sessions`, purely so the front end can function before the API server exists. They are labelled `INTERIM` and must all be deleted once auth moves server-side. Treat the current checks as a UX guarantee only — don't put anything sensitive behind them.

The `update` policy is the widest hole: RLS cannot restrict *which columns* an update touches, so with the anon key it permits editing any row. It exists only so `setInitialPassword` can work. Nothing else should use it.

### Sessions

Opaque 32-byte random hex token, stored in `localStorage` under `its.session` and in the `sessions` table with an 8-hour TTL. `getCurrentUser` resolves the token via a join and clears it on expiry or lookup failure. There is no refresh — sessions simply expire.

**Only `login` creates a session.** `createAccount` deliberately does not — the creator stays signed in as themselves, and the new account signs in later with the password it was given.

### Passwords

`src/lib/password.js` — PBKDF2-SHA256, 210,000 iterations, over the Web Crypto API. The stored format is `pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>`; the iteration count is read back from the string, so raising `ITERATIONS` doesn't invalidate existing hashes. Web Crypto was chosen over a library because Node exposes the same interface, so this file ports to the API server unchanged. Comparison is timing-safe.

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

`creatableRole(role)` in `src/lib/roles.js` is the single source of truth for who creates whom — admin→agency, agency→client, client→nothing. **Nothing maps to `admin`**, so no account is mintable from the browser at any privilege level; `roles.test.js` asserts this directly.

`createAccount` derives the new role from the signed-in user and takes no `role` parameter, so there is no field a form could tamper with. It sets `parent_id`/`parent_role` from the creator.

### Temporary passwords and forced first change

`createAccount` takes **no password either** — it generates one, and returns `{ account, temporaryPassword }`. That plaintext crosses the API boundary exactly once, is shown to the creator in a callout on `/accounts`, and is never recoverable afterwards. The creator therefore never learns the password the account ends up with.

New accounts carry `users.must_change_password`. While it is set:

- `ProtectedRoute` redirects every protected route to `/set-password`.
- `/set-password` is guarded by `PasswordSetupRoute` instead, which requires the flag to be set and sends settled accounts to `/dashboard`. **The two guards are deliberate mirror images** — that is what stops them redirecting into each other. Don't put `/set-password` behind `ProtectedRoute`.

`setInitialPassword` refuses to run unless the flag is set, so it cannot double as a password reset for an established account. It does **not** ask for the current password: the session token is the proof of identity and the user typed the temporary password moments earlier. It deletes the account's *other* sessions on success, keeping the one making the change.

After it succeeds the page must call `AuthContext.refresh()` before navigating, or the guards still see the stale flag and bounce straight back.

Seeded accounts have `must_change_password = false` so their documented credentials keep working. To exercise the flow, create an account through the UI.

### Password policy

`src/lib/passwordPolicy.js` owns both the rules and the generator. `PASSWORD_RULES` is a single array consumed by the live checklist on `/set-password` *and* by the check inside `setInitialPassword`, so the feedback and the enforcement cannot drift apart. Add rules there, nowhere else.

`MIN_LENGTH` is **10**, inclusive — a 10-character password passes. One constant to change if that moves.

On `/set-password` the two password boxes sit directly above one another and the requirements checklist sits **below both**, describing them jointly. A test asserts that ordering, so moving the list back up between the fields will fail.

`generatePassword()` satisfies the policy by construction (one character from each required set, remainder from all, then shuffled). It draws from `crypto.getRandomValues` with rejection sampling rather than `% n`, which would bias towards low indices. Ambiguous glyphs (`0 O 1 l I`) are excluded from every set because these passwords get read off a screen and typed by hand.

### Routing

`src/App.jsx` holds the whole route table: `/login`, `/set-password`, `/dashboard`, `/accounts`. **There is no `/register`** — it was removed when sign-up became top-down. Three guards wrap route elements:

- `ProtectedRoute` — requires a session; optional `requiredRole` prop, redirects to `/dashboard` if the role is too low. Stashes the attempted location in `location.state.from` so `Login` can send the user back after signing in. `/accounts` uses `requiredRole={ROLES.AGENCY}`, which admits agencies and admins because the check is inclusive upward.
- `GuestRoute` — bounces signed-in users away from `/login`.
- `PasswordSetupRoute` — guards `/set-password` only; see the forced-change section above.

Both render a loading state while `AuthContext` resolves. `AuthProvider`'s `loading` starts `true` for this reason: without it, a signed-in user gets flashed to `/login` on first paint before the session resolves. Keep that invariant if you touch the provider.

Unmatched paths redirect to `/dashboard`, which then redirects to `/login` when signed out.

## Testing

Vitest with jsdom; config lives in the `test` block of `vite.config.js`, not a separate file. `globals: true`, so `describe`/`it`/`expect` need no import (existing tests import them from `vitest` anyway — follow the local file).

`src/test/setup.js` polyfills `crypto.subtle` from `node:crypto`, because jsdom ships `getRandomValues` but not `SubtleCrypto` and `src/lib/password.js` needs it. That gap is the test environment's alone — browsers provide it.

`src/App.test.jsx` is a smoke test: it renders the full tree and asserts the login form appears. A blank page in the browser is nearly always a render-time throw, and this catches it without opening a browser.

Page-level tests mock `../api/auth` wholesale and drive the real `<App />`, setting the starting route with `window.history.pushState` before `render`. That exercises the actual guards and routing rather than a component in isolation, and keeps the tests off Supabase entirely — the `src/api/` boundary is what makes a one-module mock sufficient.

`Accounts` loads its list in an effect, so tests must await the load settling (`await screen.findByText(/no … accounts yet/i)`) before asserting, or React emits `act()` warnings that bury real failures.

Query the login password box as `getByLabelText('Password')`, exactly. `PasswordField`'s show/hide toggle carries `aria-label="Show password"`, which `/password/i` also matches — the loose query finds two elements and throws.

## Environment note

Node here is v18.2.0. `iceberg-js`, a transitive dependency of `@supabase/supabase-js` → `@supabase/storage-js`, declares `node >=20` and warns on install. Tests and builds pass regardless; if Supabase **storage** calls misbehave, upgrading Node is the fix.

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

Every `VITE_`-prefixed variable is inlined into the browser bundle. Only the publishable/anon key belongs in `.env` — never the `sb_secret_` service-role key.

## Architecture

React 18 + Vite SPA. **Supabase is used as a database only** — its own auth stack is explicitly disabled in `src/lib/supabase.js` (`persistSession`, `autoRefreshToken`, `detectSessionInUrl` all false) so it never competes with the sessions this app issues itself.

### The auth boundary

`src/api/auth.js` is the single place the browser touches credentials or the `users` table. It exports exactly four functions — `register`, `login`, `getCurrentUser`, `logout` — plus an `AuthError` carrying an optional `field` for form-level highlighting.

Everything above it talks only to those four functions:

```
pages/ + components/  →  context/AuthContext  →  api/auth  →  lib/supabase
```

This layering is deliberate. Standing up the real API server means reimplementing `src/api/auth.js` as `fetch` calls and deleting the interim RLS policies in `supabase/schema.sql` — **no other file should need to change**. Preserve that property when adding features: new data access belongs behind a module in `src/api/`, not in a component.

### Current stage is not a security boundary

Auth checks run in the browser against the anon key. The interim RLS policies at the bottom of `supabase/schema.sql` grant `anon` broad read on `users` and full control of `sessions` purely so the front end can function before the API server exists. They are labelled `INTERIM` and must all be deleted once auth moves server-side. Treat the current checks as a UX guarantee only — don't put anything sensitive behind them.

### Sessions

Opaque 32-byte random hex token, stored in `localStorage` under `its.session` and in the `sessions` table with an 8-hour TTL. `getCurrentUser` resolves the token via a join and clears it on expiry or lookup failure. There is no refresh — sessions simply expire.

### Passwords

`src/lib/password.js` — PBKDF2-SHA256, 210,000 iterations, over the Web Crypto API. The stored format is `pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>`; the iteration count is read back from the string, so raising `ITERATIONS` doesn't invalidate existing hashes. Web Crypto was chosen over a library because Node exposes the same interface, so this file ports to the API server unchanged. Comparison is timing-safe.

### Roles

`client` → `agency` → `admin`, ascending. `hasRole(role, required)` is **inclusive of everything above** — `hasRole('admin', 'agency')` is true. Registration always hardcodes `ROLES.CLIENT`; elevation is an admin action and must never be self-selected by the form. The DB enforces this too via the `interim: anon insert users` policy's `with check (role = 'client')`.

### Routing

`src/App.jsx` holds the whole route table. Two guards wrap route elements:

- `ProtectedRoute` — requires a session; optional `requiredRole` prop, redirects to `/dashboard` if the role is too low. Stashes the attempted location in `location.state.from` so `Login` can send the user back after signing in.
- `GuestRoute` — bounces signed-in users away from `/login` and `/register`.

Both render a loading state while `AuthContext` resolves. `AuthProvider`'s `loading` starts `true` for this reason: without it, a signed-in user gets flashed to `/login` on first paint before the session resolves. Keep that invariant if you touch the provider.

Unmatched paths redirect to `/dashboard`, which then redirects to `/login` when signed out.

## Testing

Vitest with jsdom; config lives in the `test` block of `vite.config.js`, not a separate file. `globals: true`, so `describe`/`it`/`expect` need no import (existing tests import them from `vitest` anyway — follow the local file).

`src/test/setup.js` polyfills `crypto.subtle` from `node:crypto`, because jsdom ships `getRandomValues` but not `SubtleCrypto` and `src/lib/password.js` needs it. That gap is the test environment's alone — browsers provide it.

`src/App.test.jsx` is a smoke test: it renders the full tree and asserts the login form appears. A blank page in the browser is nearly always a render-time throw, and this catches it without opening a browser.

## Environment note

Node here is v18.2.0. `iceberg-js`, a transitive dependency of `@supabase/supabase-js` → `@supabase/storage-js`, declares `node >=20` and warns on install. Tests and builds pass regardless; if Supabase **storage** calls misbehave, upgrading Node is the fix.

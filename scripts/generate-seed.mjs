// ---------------------------------------------------------------------------
// Regenerates supabase/seed.sql — the fixed test accounts, one per role, wired
// into the hierarchy: admin => agency => client.
//
// Passwords are stored in the PBKDF2 format defined by src/lib/password.js, and
// Postgres cannot produce that format (pgcrypto has no PBKDF2), so the hashes
// have to be computed here and baked into the SQL as literals. This works
// because password.js is built on the Web Crypto API, which Node exposes with
// the same interface — the same reason it will port to the API server unchanged.
//
// Run with: npm run seed
// ---------------------------------------------------------------------------

import { webcrypto } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 18 only exposes Web Crypto globally behind a flag; 19+ has it by default.
// Same gap src/test/setup.js papers over for jsdom.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// Imported after the polyfill so hashPassword has crypto.subtle available.
const { hashPassword } = await import('../src/lib/password.js');
const { checkPassword } = await import('../src/lib/passwordPolicy.js');

// Parent-first order matters: each row's parent must already exist when it is
// inserted, and the users_parent_fkey constraint enforces that.
const HIERARCHY = [
  { role: 'admin', parentRole: null },
  { role: 'agency', parentRole: 'admin' },
  { role: 'client', parentRole: 'agency' },
];

// Convention, per role: <role>@email.com / <role>0Password?
// The shape is deliberate — it satisfies every rule in PASSWORD_RULES, so the
// seeded logins would still be accepted if they ever went through the policy.
const accounts = HIERARCHY.map(({ role, parentRole }) => ({
  role,
  parentRole,
  email: `${role}@email.com`,
  password: `${role}0Password?`,
  fullName: `${role[0].toUpperCase()}${role.slice(1)} Test User`,
  parentEmail: parentRole ? `${parentRole}@email.com` : null,
}));

// Fails the build rather than emitting a seed that contradicts the policy the
// rest of the app enforces.
for (const { role, password } of accounts) {
  const { valid, results } = checkPassword(password);
  if (!valid) {
    const failed = results.filter((r) => !r.met).map((r) => r.label);
    throw new Error(`Seed password for ${role} breaks the policy: ${failed.join(', ')}`);
  }
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Re-seeding resets an existing row in place rather than duplicating it, so the
// account keeps its id and anything already pointing at it stays valid.
const ON_CONFLICT = `on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;`;

const COLUMNS =
  '(email, full_name, password_hash, role, parent_id, parent_role, must_change_password)';

// Seeded accounts skip the forced password change so their documented
// credentials keep working. Accounts made through the app get `true`.
const MUST_CHANGE = 'false';

async function statement(a) {
  const hash = await hashPassword(a.password);
  const head = `-- ${a.role}${a.parentEmail ? ` — belongs to ${a.parentEmail}` : ' — top of the tree'}
insert into public.users ${COLUMNS}`;

  if (!a.parentEmail) {
    return `${head}
values (${quote(a.email)}, ${quote(a.fullName)}, ${quote(hash)}, ${quote(a.role)}, null, null, ${MUST_CHANGE})
${ON_CONFLICT}`;
  }

  // The parent's id is looked up rather than hardcoded, so this survives the
  // parent row having been created with a different uuid.
  return `${head}
select ${quote(a.email)}, ${quote(a.fullName)}, ${quote(hash)}, ${quote(a.role)}, id, ${quote(a.parentRole)}, ${MUST_CHANGE}
from public.users
where email = ${quote(a.parentEmail)}
${ON_CONFLICT}`;
}

const statements = [];
for (const a of accounts) {
  statements.push(await statement(a));
}

const emailList = accounts.map((a) => quote(a.email)).join(', ');

const sql = `-- Internal Ticket System — test accounts, one per role.
-- GENERATED FILE — edit scripts/generate-seed.mjs and run \`npm run seed\`.
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
${accounts.map((a) => `--   ${a.role.padEnd(6)} ${a.email.padEnd(20)} ${a.password}`).join('\n')}
--
-- Safe to re-run: existing rows are reset to these values rather than duplicated.

${statements.join('\n\n')}

-- Drop any sessions these accounts already held, so a re-seed forces a fresh
-- sign-in rather than leaving a stale token pointing at the old row.
delete from public.sessions
where user_id in (select id from public.users where email in (${emailList}));
`;

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'seed.sql'
);

await writeFile(outPath, sql, 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
for (const a of accounts) {
  const under = a.parentEmail ? ` (under ${a.parentEmail})` : '';
  console.log(`  ${a.role.padEnd(6)} ${a.email.padEnd(20)} ${a.password}${under}`);
}

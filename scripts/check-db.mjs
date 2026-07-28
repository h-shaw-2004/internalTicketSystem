// ---------------------------------------------------------------------------
// Connection and setup check. Run with: npm run check:db
//
// Answers, in order: can we reach the database, has schema.sql been run, has
// seed.sql been run, and is RLS locked down. Each step reports on its own so a
// failure says which one to fix rather than just "it didn't work".
// ---------------------------------------------------------------------------

import 'dotenv/config';
import pg from 'pg';

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in .env\n');
  console.error('  Supabase → Project Settings → Database → Connection string → URI');
  console.error('  Add it to .env as:  DATABASE_URL=postgresql://postgres:...');
  process.exit(1);
}

// Never print the password.
const redacted = DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');
console.log(`Connecting to ${redacted}\n`);

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

let failed = false;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  failed = true;
  console.log(`✗ ${msg}`);
};

try {
  const { rows } = await pool.query('select current_user, version()');
  ok(`connected as "${rows[0].current_user}"`);
  console.log(`  ${rows[0].version.split(',')[0]}\n`);
} catch (error) {
  console.error(`✗ could not connect: ${error.message}\n`);
  if (['ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)) {
    console.error('  The direct connection host (db.*.supabase.co) is IPv6-only on newer');
    console.error('  Supabase projects, and most home/office networks cannot route to it.');
    console.error('');
    console.error('  Use the SESSION POOLER string instead — it is IPv4:');
    console.error('    Dashboard → Connect → Session pooler');
    console.error('    postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres');
    console.error('');
    console.error('  Note the username changes from "postgres" to "postgres.<project-ref>".');
  }
  if (/password authentication failed/i.test(error.message)) {
    console.error('  Check you replaced [YOUR-PASSWORD] with your database password.');
    console.error('  If it contains @ : / ? # or %, it must be percent-encoded.');
  }
  await pool.end();
  process.exit(1);
}

// --- schema ---------------------------------------------------------------
const expectedTables = ['users', 'sessions', 'tickets'];
const { rows: tables } = await pool.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any($1)`,
  [expectedTables]
);
const present = tables.map((t) => t.table_name);

for (const table of expectedTables) {
  if (present.includes(table)) ok(`table "${table}" exists`);
  else bad(`table "${table}" is MISSING — run supabase/schema.sql`);
}

if (present.includes('users')) {
  const { rows } = await pool.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name in ('parent_id','parent_role','must_change_password')`
  );
  if (rows.length === 3) ok('users has the hierarchy and password columns');
  else bad(`users is missing columns (found ${rows.length}/3) — re-run schema.sql`);
}

// --- seed -----------------------------------------------------------------
if (present.includes('users')) {
  const { rows } = await pool.query(
    `select u.email, u.role, p.email as parent_email
       from users u left join users p on p.id = u.parent_id
      order by u.role desc, u.email`
  );

  if (rows.length === 0) {
    bad('no accounts found — run supabase/seed.sql');
  } else {
    ok(`${rows.length} account(s):`);
    for (const r of rows) {
      console.log(`    ${r.role.padEnd(7)} ${r.email.padEnd(22)} parent: ${r.parent_email ?? '—'}`);
    }
    const orphans = rows.filter((r) => r.role !== 'admin' && !r.parent_email);
    if (orphans.length) bad(`${orphans.length} non-admin account(s) have no parent`);
  }
}

if (present.includes('tickets')) {
  const { rows } = await pool.query('select count(*)::int as n from tickets');
  ok(`${rows[0].n} ticket(s)`);
}

// --- RLS ------------------------------------------------------------------
const { rows: policies } = await pool.query(
  `select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' group by tablename`
);

if (policies.length === 0) {
  ok('no RLS policies — correct, the API is the only way in');
} else {
  bad('leftover RLS policies (re-run schema.sql to drop them):');
  for (const p of policies) console.log(`    ${p.tablename}: ${p.n}`);
}

await pool.end();

console.log(failed ? '\nSomething needs fixing — see the ✗ lines above.' : '\nAll good.');
process.exit(failed ? 1 : 0);

import pg from 'pg';
import { DATABASE_URL } from './env.js';

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

/**
 * One pool for the process. Connecting as the database owner means row level
 * security does not apply to us — every access rule is enforced by this server
 * instead, which is the whole point of having one.
 */
export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  // Supabase requires TLS but presents a cert this pool has no CA bundle for.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

/** First row, or null. */
export async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** All rows. */
export async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/** Postgres unique-violation, used to catch a duplicate email race. */
export const isUniqueViolation = (error) => error?.code === '23505';

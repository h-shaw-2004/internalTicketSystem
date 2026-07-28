import 'dotenv/config';
import { webcrypto } from 'node:crypto';

// Node 18 does not expose Web Crypto as a global in module files — only inside
// `node -e` one-liners, which makes it very easy to "verify" wrongly. Node 19+
// has it by default. shared/password.js is written against the browser API on
// purpose, so the server supplies it here, before any route can call it.
//
// Without this, every hash silently fails and login reports "Email or password
// is incorrect", because verifyPassword cannot tell a broken environment from a
// wrong password.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

export const PORT = Number(process.env.PORT ?? 3001);
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const DATABASE_URL = process.env.DATABASE_URL;

// Unlike the browser, a server with no database has nothing useful to do, so
// this fails at boot with a message naming the fix rather than starting and
// erroring on every request.
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Supabase ' +
      'connection string (Project Settings → Database → Connection string → URI).'
  );
}

import 'dotenv/config';

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

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Set when the environment is not configured, null otherwise.
 *
 * This is reported rather than thrown. Throwing here happens while the module
 * graph is still being evaluated, before React mounts, so it takes the whole app
 * down to a blank white page with the reason only in the console — no error
 * boundary can catch it. src/main.jsx checks this and renders a real screen.
 */
export const configError =
  !url || !anonKey
    ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.'
    : null;

// Supabase is the database only — its own auth stack is switched off so it never
// competes with the sessions we issue in src/api/auth.js.
//
// When unconfigured this is a stub that throws on first use. main.jsx never
// renders the app in that state, so it should be unreachable; if something does
// reach it, the message says why rather than "cannot read properties of null".
export const supabase = configError
  ? new Proxy(
      {},
      {
        get() {
          throw new Error(configError);
        },
      }
    )
  : createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

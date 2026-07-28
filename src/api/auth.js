// ---------------------------------------------------------------------------
// The auth API — client half.
//
// Every function here is a thin call to the Express server in /server. All of
// the rules (who may create whom, password hashing, session lifetime) live
// there, where a user cannot reach them. This file only shapes requests and
// responses.
//
// The signatures are unchanged from when this talked to Supabase directly, so
// nothing above it — context, pages, guards, tests — had to change.
// ---------------------------------------------------------------------------

import { HttpError, createClient } from '../lib/http';

export class AuthError extends HttpError {
  constructor(message, options) {
    super(message, options);
    this.name = 'AuthError';
  }
}

const request = createClient(AuthError);

/** The signed-in user, or null. Never throws for a signed-out visitor. */
export async function getCurrentUser() {
  const { user } = await request('/auth/me');
  return user;
}

/** Verify credentials and start a session. */
export async function login({ email, password }) {
  const { user } = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return user;
}

/** End the current session. */
export async function logout() {
  await request('/auth/logout', { method: 'POST' });
}

/**
 * Create the account one level below the signed-in user. The new role and the
 * temporary password are both decided by the server; the caller supplies only a
 * name and an email.
 *
 * Returns `{ account, temporaryPassword }` — the plaintext arrives exactly once
 * and is never recoverable afterwards.
 */
export async function createAccount({ fullName, email }) {
  return request('/accounts', { method: 'POST', body: { fullName, email } });
}

/** The accounts the signed-in user owns, newest first. */
export async function listChildAccounts() {
  const { accounts } = await request('/accounts');
  return accounts;
}

/** Replace a generated temporary password with a chosen one. */
export async function setInitialPassword({ newPassword }) {
  const { user } = await request('/auth/password', {
    method: 'POST',
    body: { newPassword },
  });
  return user;
}

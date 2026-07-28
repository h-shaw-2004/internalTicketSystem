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
 * Create an account below the signed-in user.
 *
 * `role` may be omitted when the caller has only one option (an agency always
 * creates clients). `agencyId` is required only when an admin creates a client,
 * since a client's parent must be an agency and cannot be inferred.
 *
 * The server re-checks both against what the session is allowed to create, and
 * generates the password. Returns `{ account, temporaryPassword }` — the
 * plaintext arrives exactly once and is never recoverable afterwards.
 */
export async function createAccount({ fullName, email, role, agencyId }) {
  return request('/accounts', {
    method: 'POST',
    body: { fullName, email, role, agencyId },
  });
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

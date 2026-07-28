// ---------------------------------------------------------------------------
// The auth API.
//
// This module is the ONLY place the browser touches credentials or the users
// table. Everything above it (context, pages, guards) talks to these six
// functions and nothing else, so standing the real API server up means
// reimplementing this file as `fetch` calls and deleting the interim RLS
// policies in supabase/schema.sql — no other file changes.
//
// There is no public sign-up. Accounts are created top-down by the account
// above them (see createAccount), and admins are seeded via supabase/seed.sql.
//
// Until that happens the checks below run in the browser, which means they are
// a UX guarantee, not a security boundary. Do not put anything sensitive behind
// them yet.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase';
import { hashPassword, verifyPassword } from '../lib/password';
import { checkPassword, generatePassword } from '../lib/passwordPolicy';
import { creatableRole } from '../lib/roles';

const SESSION_STORAGE_KEY = 'its.session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
const USER_FIELDS =
  'id, email, full_name, role, parent_id, must_change_password, created_at';

export class AuthError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'AuthError';
    this.field = field;
  }
}

const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    parentId: row.parent_id ?? null,
    mustChangePassword: row.must_change_password ?? false,
    createdAt: row.created_at,
  };
}

function readToken() {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

function writeToken(token) {
  localStorage.setItem(SESSION_STORAGE_KEY, token);
}

function clearToken() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error } = await supabase
    .from('sessions')
    .insert({ token, user_id: userId, expires_at: expiresAt });

  if (error) throw new AuthError('Could not start a session. Please try again.');

  writeToken(token);
  return token;
}

/**
 * Create the account one level below the signed-in user: an admin creates an
 * agency, an agency creates a client. The new account's role is derived from
 * the creator rather than supplied by the caller, so there is no parameter a
 * form could tamper with to mint a higher-privileged account.
 *
 * The creator becomes the new account's parent, which is what makes "a client
 * has exactly one agency" and "an agency has exactly one admin" true. Postgres
 * re-checks the pairing via users_hierarchy_check.
 *
 * The password is generated here, not chosen by the creator — it is returned
 * once, in plaintext, for the creator to pass on, and never recoverable
 * afterwards. The new account carries must_change_password until it picks its
 * own, so the creator never knows the password the account ends up with.
 *
 * Does NOT sign the new account in — the creator stays signed in as themselves.
 */
export async function createAccount({ fullName, email }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AuthError('Your session has expired. Please sign in again.');

  const role = creatableRole(actor.role);
  if (!role) throw new AuthError('Your account type cannot create other accounts.');

  const name = String(fullName ?? '').trim();
  const address = normaliseEmail(email);

  if (!name) throw new AuthError('Enter a full name.', 'fullName');
  if (!address) throw new AuthError('Enter an email address.', 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new AuthError('Enter a valid email address.', 'email');
  }

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', address)
    .maybeSingle();

  if (lookupError) throw new AuthError('Could not reach the server. Please try again.');
  if (existing) throw new AuthError('An account with that email already exists.', 'email');

  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: address,
      full_name: name,
      password_hash: passwordHash,
      role,
      parent_id: actor.id,
      parent_role: actor.role,
      must_change_password: true,
    })
    .select(USER_FIELDS)
    .single();

  // Unique violation — the same email was taken between the check above and
  // this insert.
  if (error?.code === '23505') {
    throw new AuthError('An account with that email already exists.', 'email');
  }
  if (error) throw new AuthError('Could not create the account. Please try again.');

  // The plaintext leaves this module exactly once. Nothing stores it.
  return { account: toUser(data), temporaryPassword };
}

/**
 * Replace the generated temporary password with one the account has chosen.
 *
 * Only callable while must_change_password is set, so this cannot be used as a
 * password reset for an established account. The current password is not asked
 * for again: the session token is the proof of identity, and the user typed the
 * temporary password moments ago to get here.
 */
export async function setInitialPassword({ newPassword }) {
  const actor = await getCurrentUser();
  if (!actor) throw new AuthError('Your session has expired. Please sign in again.');

  if (!actor.mustChangePassword) {
    throw new AuthError('This account has already chosen a password.');
  }

  if (!checkPassword(newPassword).valid) {
    throw new AuthError('Password does not meet the requirements.', 'newPassword');
  }

  const passwordHash = await hashPassword(newPassword);

  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash, must_change_password: false })
    .eq('id', actor.id);

  if (error) throw new AuthError('Could not set your password. Please try again.');

  // Anyone else holding a session issued against the temporary password loses
  // it. The session doing the changing is kept so the user stays signed in.
  const token = readToken();
  await supabase.from('sessions').delete().eq('user_id', actor.id).neq('token', token);

  return { ...actor, mustChangePassword: false };
}

/** The accounts the signed-in user owns, newest first. */
export async function listChildAccounts() {
  const actor = await getCurrentUser();
  if (!actor) throw new AuthError('Your session has expired. Please sign in again.');

  const { data, error } = await supabase
    .from('users')
    .select(USER_FIELDS)
    .eq('parent_id', actor.id)
    .order('created_at', { ascending: false });

  if (error) throw new AuthError('Could not load accounts. Please try again.');

  return data.map(toUser);
}

/** Verify credentials and start a session. */
export async function login({ email, password }) {
  const address = normaliseEmail(email);

  if (!address) throw new AuthError('Enter your email address.', 'email');
  if (!password) throw new AuthError('Enter your password.', 'password');

  const { data, error } = await supabase
    .from('users')
    .select(`${USER_FIELDS}, password_hash`)
    .eq('email', address)
    .maybeSingle();

  if (error) throw new AuthError('Could not reach the server. Please try again.');

  // One message for both branches so the form cannot be used to enumerate
  // which email addresses have accounts.
  const invalid = new AuthError('Email or password is incorrect.');
  if (!data) throw invalid;
  if (!(await verifyPassword(password, data.password_hash))) throw invalid;

  await createSession(data.id);
  return toUser(data);
}

/** Resolve the stored session token to a user, or null if there isn't a valid one. */
export async function getCurrentUser() {
  const token = readToken();
  if (!token) return null;

  const { data, error } = await supabase
    .from('sessions')
    .select(`expires_at, users ( ${USER_FIELDS} )`)
    .eq('token', token)
    .maybeSingle();

  if (error || !data || !data.users) {
    clearToken();
    return null;
  }

  if (new Date(data.expires_at) <= new Date()) {
    await logout();
    return null;
  }

  return toUser(data.users);
}

/** End the current session, locally and in the database. */
export async function logout() {
  const token = readToken();
  clearToken();
  if (token) {
    await supabase.from('sessions').delete().eq('token', token);
  }
}

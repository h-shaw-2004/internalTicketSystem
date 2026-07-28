// ---------------------------------------------------------------------------
// The auth API.
//
// This module is the ONLY place the browser touches credentials or the users
// table. Everything above it (context, pages, guards) talks to these four
// functions and nothing else, so standing the real API server up means
// reimplementing this file as `fetch` calls and deleting the interim RLS
// policies in supabase/schema.sql — no other file changes.
//
// Until that happens the checks below run in the browser, which means they are
// a UX guarantee, not a security boundary. Do not put anything sensitive behind
// them yet.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase';
import { hashPassword, verifyPassword } from '../lib/password';
import { ROLES } from '../lib/roles';

const SESSION_STORAGE_KEY = 'its.session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
const USER_FIELDS = 'id, email, full_name, role, created_at';

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
 * Create a client account and sign it in.
 * Agency and admin accounts are promoted by an admin, never self-selected.
 */
export async function register({ fullName, email, password }) {
  const name = String(fullName ?? '').trim();
  const address = normaliseEmail(email);

  if (!name) throw new AuthError('Enter your full name.', 'fullName');
  if (!address) throw new AuthError('Enter your email address.', 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new AuthError('Enter a valid email address.', 'email');
  }
  if (String(password ?? '').length < 8) {
    throw new AuthError('Password must be at least 8 characters.', 'password');
  }

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', address)
    .maybeSingle();

  if (lookupError) throw new AuthError('Could not reach the server. Please try again.');
  if (existing) throw new AuthError('An account with that email already exists.', 'email');

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: address,
      full_name: name,
      password_hash: passwordHash,
      role: ROLES.CLIENT,
    })
    .select(USER_FIELDS)
    .single();

  // Unique violation — someone registered the same email between the check above
  // and this insert.
  if (error?.code === '23505') {
    throw new AuthError('An account with that email already exists.', 'email');
  }
  if (error) throw new AuthError('Could not create your account. Please try again.');

  await createSession(data.id);
  return toUser(data);
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

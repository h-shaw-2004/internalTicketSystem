import crypto from 'node:crypto';
import { one, query } from './db.js';
import { IS_PRODUCTION } from './env.js';
import { forbidden, unauthorised } from './errors.js';

export const SESSION_COOKIE = 'its_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

export const USER_COLUMNS =
  'id, email, full_name, role, parent_id, must_change_password, created_at';

/** Database row to the shape the client already expects. */
export function toUser(row) {
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

const cookieOptions = {
  httpOnly: true, // browser JavaScript cannot read it, so XSS cannot steal it
  sameSite: 'lax',
  secure: IS_PRODUCTION,
  path: '/',
};

const newToken = () => crypto.randomBytes(32).toString('hex');

/** Issue a session and put it in an httpOnly cookie. */
export async function startSession(res, userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [
    token,
    userId,
    expiresAt,
  ]);

  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
  return token;
}

/** Drop the current session, in the database and in the browser. */
export async function endSession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  if (token) {
    await query('delete from sessions where token = $1', [token]);
  }
}

/** Every session for this user except the one making the request. */
export async function endOtherSessions(req, userId) {
  const token = req.cookies?.[SESSION_COOKIE] ?? '';
  await query('delete from sessions where user_id = $1 and token <> $2', [userId, token]);
}

/**
 * Populates `req.user` for every request, or leaves it null. Deliberately does
 * not reject — signed-out visitors are normal, and `requireAuth` decides which
 * routes care.
 */
export async function attachUser(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  req.user = null;

  if (!token) return next();

  const row = await one(
    `select u.id, u.email, u.full_name, u.role, u.parent_id, u.must_change_password,
            u.created_at, s.expires_at
       from sessions s
       join users u on u.id = s.user_id
      where s.token = $1`,
    [token]
  );

  if (!row) {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    return next();
  }

  if (new Date(row.expires_at) <= new Date()) {
    await query('delete from sessions where token = $1', [token]);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    return next();
  }

  req.user = toUser(row);
  return next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorised());
  return next();
}

/** Exact role match, not the inclusive-upward `hasRole` used for route guards. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorised());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Your account type cannot do that.'));
    }
    return next();
  };
}

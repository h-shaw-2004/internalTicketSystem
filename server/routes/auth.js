import { Router } from 'express';
import { one, query } from '../db.js';
import { badRequest, unauthorised } from '../errors.js';
import {
  USER_COLUMNS,
  endOtherSessions,
  endSession,
  requireAuth,
  startSession,
  toUser,
} from '../session.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { checkPassword } from '../../shared/passwordPolicy.js';

const router = Router();

const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

/** Who is signed in. Returns null rather than 401 — being signed out is normal. */
router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

router.post('/login', async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  const password = req.body?.password;

  if (!email) throw badRequest('Enter your email address.', 'email');
  if (!password) throw badRequest('Enter your password.', 'password');

  const row = await one(
    `select ${USER_COLUMNS}, password_hash from users where lower(email) = $1`,
    [email]
  );

  // One message for both branches so the form cannot be used to work out which
  // email addresses have accounts.
  const invalid = unauthorised('Email or password is incorrect.');
  if (!row) throw invalid;
  if (!(await verifyPassword(password, row.password_hash))) throw invalid;

  await startSession(res, row.id);
  res.json({ user: toUser(row) });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

/**
 * Replace a generated temporary password with a chosen one.
 *
 * Only callable while must_change_password is set, so it cannot double as a
 * password reset for an established account.
 */
router.post('/password', requireAuth, async (req, res) => {
  const { user } = req;

  if (!user.mustChangePassword) {
    throw badRequest('This account has already chosen a password.');
  }

  const newPassword = req.body?.newPassword;
  if (!checkPassword(newPassword).valid) {
    throw badRequest('Password does not meet the requirements.', 'newPassword');
  }

  const passwordHash = await hashPassword(newPassword);

  await query(
    'update users set password_hash = $1, must_change_password = false where id = $2',
    [passwordHash, user.id]
  );

  // Anything issued against the temporary password stops working. The session
  // making the change is kept, so the user stays signed in.
  await endOtherSessions(req, user.id);

  res.json({ user: { ...user, mustChangePassword: false } });
});

export default router;

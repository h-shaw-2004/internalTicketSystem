import { Router } from 'express';
import { isUniqueViolation, many, one } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import { USER_COLUMNS, requireAuth, toUser } from '../session.js';
import { hashPassword } from '../../shared/password.js';
import { generatePassword } from '../../shared/passwordPolicy.js';
import { creatableRole } from '../../shared/roles.js';

const router = Router();

router.use(requireAuth);

/** The accounts the signed-in user owns, newest first. */
router.get('/', async (req, res) => {
  const rows = await many(
    `select ${USER_COLUMNS} from users where parent_id = $1 order by created_at desc`,
    [req.user.id]
  );

  res.json({ accounts: rows.map(toUser) });
});

/**
 * Create the account one level below the caller: an admin creates an agency, an
 * agency creates a client.
 *
 * The role is derived from the session, never taken from the request body, so
 * there is no field a caller could tamper with to mint an admin. The password is
 * generated here and returned exactly once for the creator to pass on.
 */
router.post('/', async (req, res) => {
  const { user } = req;

  const role = creatableRole(user.role);
  if (!role) throw forbidden('Your account type cannot create other accounts.');

  const fullName = String(req.body?.fullName ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();

  if (!fullName) throw badRequest('Enter a full name.', 'fullName');
  if (!email) throw badRequest('Enter an email address.', 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('Enter a valid email address.', 'email');
  }

  const existing = await one('select id from users where lower(email) = $1', [email]);
  if (existing) throw badRequest('An account with that email already exists.', 'email');

  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);

  let created;
  try {
    created = await one(
      `insert into users (email, full_name, password_hash, role, parent_id, parent_role, must_change_password)
       values ($1, $2, $3, $4, $5, $6, true)
       returning ${USER_COLUMNS}`,
      [email, fullName, passwordHash, role, user.id, user.role]
    );
  } catch (error) {
    // The same email was taken between the check above and this insert.
    if (isUniqueViolation(error)) {
      throw badRequest('An account with that email already exists.', 'email');
    }
    throw error;
  }

  res.status(201).json({ account: toUser(created), temporaryPassword });
});

export default router;

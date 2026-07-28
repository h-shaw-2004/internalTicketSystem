import { Router } from 'express';
import { isUniqueViolation, many, one } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import { USER_COLUMNS, requireAuth, toUser } from '../session.js';
import { hashPassword } from '../../shared/password.js';
import { generatePassword } from '../../shared/passwordPolicy.js';
import { ROLES, canCreateRole, creatableRoles, needsAgencyChoice } from '../../shared/roles.js';

const router = Router();

router.use(requireAuth);

/**
 * The accounts the caller manages, newest first.
 *
 * An agency sees its own clients. An admin sees its agencies *and* the clients
 * beneath them — an admin can create a client, but that client's parent is an
 * agency, so direct children alone would hide it the moment it was made.
 */
router.get('/', async (req, res) => {
  const { user } = req;

  // Each row already carries parent_id, which is all the client needs to group
  // clients under their agency — so no join for the parent's name.
  const rows =
    user.role === ROLES.ADMIN
      ? await many(
          `select ${USER_COLUMNS}
             from users
            where parent_id = $1
               or parent_id in (select id from users where parent_id = $1)
            order by created_at desc`,
          [user.id]
        )
      : await many(
          `select ${USER_COLUMNS} from users where parent_id = $1 order by created_at desc`,
          [user.id]
        );

  res.json({ accounts: rows.map(toUser) });
});

/**
 * Create an account below the caller.
 *
 * `role` is accepted from the body now that an admin has a choice, but it is
 * checked against creatableRoles — so the widening is "which of my permitted
 * roles", never "any role". Nothing maps to admin, so no request can mint one.
 *
 * The parent is still never taken from the body except for the one case that
 * needs it: an admin creating a client must name one of *its own* agencies,
 * because a client's parent has to be an agency.
 */
router.post('/', async (req, res) => {
  const { user } = req;
  const allowed = creatableRoles(user.role);

  if (allowed.length === 0) {
    throw forbidden('Your account type cannot create other accounts.');
  }

  // With one option the role is implied, which keeps the agency flow unchanged.
  const role = req.body?.role ?? (allowed.length === 1 ? allowed[0] : null);

  if (!role) throw badRequest('Choose an account type.', 'role');
  if (!canCreateRole(user.role, role)) {
    throw forbidden('Your account type cannot create that kind of account.');
  }

  const fullName = String(req.body?.fullName ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();

  if (!fullName) throw badRequest('Enter a full name.', 'fullName');
  if (!email) throw badRequest('Enter an email address.', 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('Enter a valid email address.', 'email');
  }

  // Who the new account hangs off.
  let parentId = user.id;
  let parentRole = user.role;

  if (needsAgencyChoice(user.role, role)) {
    const agencyId = req.body?.agencyId;
    if (!agencyId) throw badRequest('Choose an agency for this client.', 'agencyId');

    const agency = await one('select id, role, parent_id from users where id = $1', [agencyId]);

    // Must exist, be an agency, and be one of this admin's own.
    if (!agency || agency.role !== ROLES.AGENCY || agency.parent_id !== user.id) {
      throw badRequest('That agency is not one of yours.', 'agencyId');
    }

    parentId = agency.id;
    parentRole = ROLES.AGENCY;
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
      [email, fullName, passwordHash, role, parentId, parentRole]
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

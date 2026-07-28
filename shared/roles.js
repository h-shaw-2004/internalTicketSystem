// Account types, in ascending order of privilege: client => agency => admin.
export const ROLES = {
  CLIENT: 'client',
  AGENCY: 'agency',
  ADMIN: 'admin',
};

const RANK = {
  [ROLES.CLIENT]: 1,
  [ROLES.AGENCY]: 2,
  [ROLES.ADMIN]: 3,
};

export const ROLE_LABELS = {
  [ROLES.CLIENT]: 'Client',
  [ROLES.AGENCY]: 'Agency',
  [ROLES.ADMIN]: 'Admin',
};

/** True when `role` sits at or above `required` in the hierarchy. */
export function hasRole(role, required) {
  const held = RANK[role] ?? 0;
  const needed = RANK[required] ?? 0;
  return held > 0 && held >= needed;
}

// Account creation runs exactly one level down: an admin creates agencies, an
// agency creates clients, and a client creates nothing. Admins are not listed
// as creatable by anyone — they are seeded through the SQL editor, which is the
// only channel that bypasses RLS.
const CREATES = {
  [ROLES.ADMIN]: ROLES.AGENCY,
  [ROLES.AGENCY]: ROLES.CLIENT,
};

/** The single role `role` may create, or null if it may not create accounts. */
export function creatableRole(role) {
  return CREATES[role] ?? null;
}

/** True when `role` may create accounts at all. */
export function canCreateAccounts(role) {
  return creatableRole(role) !== null;
}

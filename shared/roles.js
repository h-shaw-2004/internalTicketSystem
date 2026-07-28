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

// Who may create what.
//
// An admin creates agencies, and also clients — but a client's parent must be an
// agency (users_hierarchy_check enforces that), so an admin creating one has to
// assign it to one of their own agencies rather than owning it directly.
//
// **Nothing maps to `admin`.** No account of any kind can create an admin; they
// come from supabase/seed.sql, the only channel that reaches the database
// without going through the API.
const CREATES = {
  [ROLES.ADMIN]: [ROLES.AGENCY, ROLES.CLIENT],
  [ROLES.AGENCY]: [ROLES.CLIENT],
  [ROLES.CLIENT]: [],
};

/** The roles `role` may create, most senior first. Empty if it may not. */
export function creatableRoles(role) {
  return CREATES[role] ?? [];
}

/** True when `role` may create accounts at all. */
export function canCreateAccounts(role) {
  return creatableRoles(role).length > 0;
}

/** True when `actorRole` may create an account of `targetRole`. */
export function canCreateRole(actorRole, targetRole) {
  return creatableRoles(actorRole).includes(targetRole);
}

/**
 * True when creating `targetRole` requires naming an agency: only an admin
 * making a client, since the agency cannot be inferred from the creator.
 */
export function needsAgencyChoice(actorRole, targetRole) {
  return actorRole === ROLES.ADMIN && targetRole === ROLES.CLIENT;
}

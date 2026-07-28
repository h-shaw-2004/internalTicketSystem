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

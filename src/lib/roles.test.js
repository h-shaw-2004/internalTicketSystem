import { describe, expect, it } from 'vitest';
import { ROLES, hasRole } from './roles';

describe('hasRole', () => {
  it('admits a role at its own level', () => {
    expect(hasRole(ROLES.CLIENT, ROLES.CLIENT)).toBe(true);
    expect(hasRole(ROLES.AGENCY, ROLES.AGENCY)).toBe(true);
    expect(hasRole(ROLES.ADMIN, ROLES.ADMIN)).toBe(true);
  });

  it('admits higher roles to lower requirements', () => {
    expect(hasRole(ROLES.ADMIN, ROLES.CLIENT)).toBe(true);
    expect(hasRole(ROLES.ADMIN, ROLES.AGENCY)).toBe(true);
    expect(hasRole(ROLES.AGENCY, ROLES.CLIENT)).toBe(true);
  });

  it('refuses lower roles', () => {
    expect(hasRole(ROLES.CLIENT, ROLES.AGENCY)).toBe(false);
    expect(hasRole(ROLES.CLIENT, ROLES.ADMIN)).toBe(false);
    expect(hasRole(ROLES.AGENCY, ROLES.ADMIN)).toBe(false);
  });

  it('refuses unknown or missing roles', () => {
    expect(hasRole(undefined, ROLES.CLIENT)).toBe(false);
    expect(hasRole('superuser', ROLES.CLIENT)).toBe(false);
  });
});

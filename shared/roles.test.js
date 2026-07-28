import { describe, expect, it } from 'vitest';
import { ROLES, canCreateAccounts, creatableRole, hasRole } from './roles.js';

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

describe('creatableRole', () => {
  it('steps exactly one level down', () => {
    expect(creatableRole(ROLES.ADMIN)).toBe(ROLES.AGENCY);
    expect(creatableRole(ROLES.AGENCY)).toBe(ROLES.CLIENT);
  });

  it('gives clients nothing to create', () => {
    expect(creatableRole(ROLES.CLIENT)).toBeNull();
  });

  it('never lets anyone create an admin', () => {
    expect(Object.values(ROLES).map(creatableRole)).not.toContain(ROLES.ADMIN);
  });

  it('refuses unknown or missing roles', () => {
    expect(creatableRole(undefined)).toBeNull();
    expect(creatableRole('superuser')).toBeNull();
  });
});

describe('canCreateAccounts', () => {
  it('is true only for admin and agency', () => {
    expect(canCreateAccounts(ROLES.ADMIN)).toBe(true);
    expect(canCreateAccounts(ROLES.AGENCY)).toBe(true);
    expect(canCreateAccounts(ROLES.CLIENT)).toBe(false);
    expect(canCreateAccounts(undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ROLES,
  canCreateAccounts,
  canCreateRole,
  creatableRoles,
  hasRole,
  needsAgencyChoice,
} from './roles.js';

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

describe('creatableRoles', () => {
  it('lets an admin create agencies and clients', () => {
    expect(creatableRoles(ROLES.ADMIN)).toEqual([ROLES.AGENCY, ROLES.CLIENT]);
  });

  it('limits an agency to clients', () => {
    expect(creatableRoles(ROLES.AGENCY)).toEqual([ROLES.CLIENT]);
  });

  it('gives clients nothing to create', () => {
    expect(creatableRoles(ROLES.CLIENT)).toEqual([]);
  });

  it('never lets anyone create an admin', () => {
    for (const role of Object.values(ROLES)) {
      expect(creatableRoles(role)).not.toContain(ROLES.ADMIN);
    }
  });

  it('refuses unknown or missing roles', () => {
    expect(creatableRoles(undefined)).toEqual([]);
    expect(creatableRoles('superuser')).toEqual([]);
  });
});

describe('canCreateRole', () => {
  it('permits only what creatableRoles lists', () => {
    expect(canCreateRole(ROLES.ADMIN, ROLES.AGENCY)).toBe(true);
    expect(canCreateRole(ROLES.ADMIN, ROLES.CLIENT)).toBe(true);
    expect(canCreateRole(ROLES.AGENCY, ROLES.CLIENT)).toBe(true);
  });

  it('refuses sideways and upward creation', () => {
    expect(canCreateRole(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
    expect(canCreateRole(ROLES.AGENCY, ROLES.AGENCY)).toBe(false);
    expect(canCreateRole(ROLES.AGENCY, ROLES.ADMIN)).toBe(false);
    expect(canCreateRole(ROLES.CLIENT, ROLES.CLIENT)).toBe(false);
  });
});

describe('needsAgencyChoice', () => {
  it('is true only when an admin makes a client', () => {
    // The agency cannot be inferred from the creator, so it must be named.
    expect(needsAgencyChoice(ROLES.ADMIN, ROLES.CLIENT)).toBe(true);
  });

  it('is false when the creator is the parent', () => {
    expect(needsAgencyChoice(ROLES.ADMIN, ROLES.AGENCY)).toBe(false);
    expect(needsAgencyChoice(ROLES.AGENCY, ROLES.CLIENT)).toBe(false);
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

import { describe, expect, it } from 'vitest';
import { ROLES } from './roles';
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_ORDER,
  STATUS_LABELS,
  STATUS_ORDER,
  TICKET_STATUSES,
  URGENCY_LABELS,
  URGENCY_ORDER,
  canCreateTickets,
  canEscalate,
  canManageTickets,
  isDepartment,
  isStatus,
  isUrgency,
} from './tickets';

describe('ticket vocabulary', () => {
  it('gives every value a label', () => {
    for (const [order, labels] of [
      [STATUS_ORDER, STATUS_LABELS],
      [DEPARTMENT_ORDER, DEPARTMENT_LABELS],
      [URGENCY_ORDER, URGENCY_LABELS],
    ]) {
      for (const value of order) {
        expect(labels[value]).toBeTruthy();
      }
    }
  });

  it('lists exactly the five statuses the brief names', () => {
    expect(STATUS_ORDER).toEqual([
      'open',
      'in_progress',
      'with_client',
      'on_hold',
      'resolved',
    ]);
    expect(Object.values(TICKET_STATUSES).sort()).toEqual([...STATUS_ORDER].sort());
  });

  it('rejects values outside each set', () => {
    expect(isStatus('open')).toBe(true);
    expect(isStatus('closed')).toBe(false);
    expect(isDepartment('network')).toBe(true);
    expect(isDepartment('catering')).toBe(false);
    expect(isUrgency('critical')).toBe(true);
    expect(isUrgency('whenever')).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});

describe('ticket permissions', () => {
  it('lets only clients raise tickets', () => {
    expect(canCreateTickets(ROLES.CLIENT)).toBe(true);
    expect(canCreateTickets(ROLES.AGENCY)).toBe(false);
    expect(canCreateTickets(ROLES.ADMIN)).toBe(false);
  });

  it('lets agencies and admins work them', () => {
    expect(canManageTickets(ROLES.AGENCY)).toBe(true);
    expect(canManageTickets(ROLES.ADMIN)).toBe(true);
    expect(canManageTickets(ROLES.CLIENT)).toBe(false);
  });

  describe('escalation', () => {
    const fresh = { escalatedAt: null };
    const already = { escalatedAt: '2026-07-28T10:00:00.000Z' };

    it('is an agency action only', () => {
      expect(canEscalate(ROLES.AGENCY, fresh)).toBe(true);
      expect(canEscalate(ROLES.CLIENT, fresh)).toBe(false);
      // An admin is the top of the tree — nobody to escalate to.
      expect(canEscalate(ROLES.ADMIN, fresh)).toBe(false);
    });

    it('cannot happen twice', () => {
      expect(canEscalate(ROLES.AGENCY, already)).toBe(false);
    });
  });
});

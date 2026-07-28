// Ticket vocabulary and the rules for who may do what to one.
//
// The enum values here mirror the Postgres types in supabase/schema.sql exactly.
// Changing a value means an `alter type ... add value` migration, so treat these
// as fixed; the labels beside them are the only part meant to be reworded.

import { ROLES } from './roles';

export const TICKET_STATUSES = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WITH_CLIENT: 'with_client',
  ON_HOLD: 'on_hold',
  RESOLVED: 'resolved',
};

// Rough lifecycle order — used for display, not enforced. Any status can move
// to any other, because real support work does not run in a straight line.
export const STATUS_ORDER = [
  TICKET_STATUSES.OPEN,
  TICKET_STATUSES.IN_PROGRESS,
  TICKET_STATUSES.WITH_CLIENT,
  TICKET_STATUSES.ON_HOLD,
  TICKET_STATUSES.RESOLVED,
];

export const STATUS_LABELS = {
  [TICKET_STATUSES.OPEN]: 'Open',
  [TICKET_STATUSES.IN_PROGRESS]: 'In Progress',
  [TICKET_STATUSES.WITH_CLIENT]: 'With Client',
  [TICKET_STATUSES.ON_HOLD]: 'On Hold',
  [TICKET_STATUSES.RESOLVED]: 'Resolved',
};

export const DEPARTMENTS = {
  HARDWARE: 'hardware',
  SOFTWARE: 'software',
  NETWORK: 'network',
  ACCESS: 'access',
  OTHER: 'other',
};

export const DEPARTMENT_ORDER = [
  DEPARTMENTS.HARDWARE,
  DEPARTMENTS.SOFTWARE,
  DEPARTMENTS.NETWORK,
  DEPARTMENTS.ACCESS,
  DEPARTMENTS.OTHER,
];

export const DEPARTMENT_LABELS = {
  [DEPARTMENTS.HARDWARE]: 'Hardware',
  [DEPARTMENTS.SOFTWARE]: 'Software',
  [DEPARTMENTS.NETWORK]: 'Network',
  [DEPARTMENTS.ACCESS]: 'Access',
  [DEPARTMENTS.OTHER]: 'Other',
};

export const URGENCIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const URGENCY_ORDER = [
  URGENCIES.LOW,
  URGENCIES.MEDIUM,
  URGENCIES.HIGH,
  URGENCIES.CRITICAL,
];

export const URGENCY_LABELS = {
  [URGENCIES.LOW]: 'Low',
  [URGENCIES.MEDIUM]: 'Medium',
  [URGENCIES.HIGH]: 'High',
  [URGENCIES.CRITICAL]: 'Critical',
};

export const isStatus = (value) => STATUS_ORDER.includes(value);
export const isDepartment = (value) => DEPARTMENT_ORDER.includes(value);
export const isUrgency = (value) => URGENCY_ORDER.includes(value);

// --------------------------------------------------------------------------
// Permissions
//
// Deliberately expressed as role questions rather than scattered `role ===`
// checks, so the pages and src/api/tickets.js answer them the same way.
// --------------------------------------------------------------------------

/** Only clients raise tickets — agencies and admins work them. */
export const canCreateTickets = (role) => role === ROLES.CLIENT;

/** Agencies and admins can move a ticket's status. */
export const canManageTickets = (role) =>
  role === ROLES.AGENCY || role === ROLES.ADMIN;

/**
 * Only an agency escalates, and only once. Escalation goes one step up the
 * hierarchy, so an admin has nobody to escalate to.
 */
export const canEscalate = (role, ticket) =>
  role === ROLES.AGENCY && !ticket?.escalatedAt;

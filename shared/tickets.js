// Ticket vocabulary and the rules for who may do what to one.
//
// The enum values here mirror the Postgres types in supabase/schema.sql exactly.
// Changing a value means an `alter type ... add value` migration, so treat these
// as fixed; the labels beside them are the only part meant to be reworded.

import { ROLES } from './roles.js';

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
// Sorting
//
// How a list is *read*, not what it contains — so it lives beside the
// vocabulary it sorts by rather than in the page. STATUS_ORDER and
// URGENCY_ORDER are already the definition of "which comes first"; deriving the
// comparators from them is what stops a dropdown ordering tickets in a sequence
// the badges disagree with.
//
// Applied in the browser to the list already fetched. The lists are one
// agency's clients' tickets and the whole list is needed anyway — TicketSummary
// counts from it and the resolved archive is split out of it — so sorting in
// SQL would cost a round trip and buy nothing. If lists ever grow enough to
// hurt, the answer is pagination first, and only then a server-side sort.
// --------------------------------------------------------------------------

export const TICKET_SORTS = {
  ACTIVITY: 'activity',
  RAISED: 'raised',
  URGENCY: 'urgency',
  STATUS: 'status',
};

export const SORT_ORDER = [
  TICKET_SORTS.ACTIVITY,
  TICKET_SORTS.RAISED,
  TICKET_SORTS.URGENCY,
  TICKET_SORTS.STATUS,
];

// Each label says which end comes first, because "Urgency" alone leaves you
// guessing whether critical is at the top or the bottom.
export const SORT_LABELS = {
  [TICKET_SORTS.ACTIVITY]: 'Latest activity',
  [TICKET_SORTS.RAISED]: 'Newest first',
  [TICKET_SORTS.URGENCY]: 'Most urgent',
  [TICKET_SORTS.STATUS]: 'Status',
};

/**
 * Latest activity, not newest raised.
 *
 * A queue is worked from whatever just moved: a ticket somebody replied to an
 * hour ago wants attention more than one raised last week and untouched since.
 * The server still returns `created_at desc`, which is only the tie-break here.
 */
export const DEFAULT_SORT = TICKET_SORTS.ACTIVITY;

export const isSort = (value) => SORT_ORDER.includes(value);

const time = (value) => {
  const parsed = Date.parse(value ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

/*
 * Unknown values sort last, whichever direction is being sorted — a status this
 * build has never heard of belongs at the bottom of a queue, not the top.
 *
 * That needs the two directions handled separately: `indexOf` returns -1, which
 * is *below* every real value, so it lands last going down and first going up.
 * `statusRank` pushes it past the end instead; `severity` leaves it at -1
 * precisely because the urgency sort runs the other way.
 */
const statusRank = (value) => {
  const index = STATUS_ORDER.indexOf(value);
  return index === -1 ? STATUS_ORDER.length : index;
};

const severity = (value) => URGENCY_ORDER.indexOf(value);

const byActivity = (a, b) =>
  time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt);

const byRaised = (a, b) => time(b.createdAt) - time(a.createdAt);

/*
 * Every comparator falls back to activity, so the order is total: two tickets
 * of the same urgency come back in a stable, meaningful sequence rather than in
 * whatever order the rows happened to arrive.
 */
const COMPARATORS = {
  [TICKET_SORTS.ACTIVITY]: (a, b) => byActivity(a, b) || byRaised(a, b),
  [TICKET_SORTS.RAISED]: byRaised,
  // URGENCY_ORDER runs low → critical, so the highest index is the most urgent
  // and the subtraction is reversed to put it at the top.
  [TICKET_SORTS.URGENCY]: (a, b) => severity(b.urgency) - severity(a.urgency) || byActivity(a, b),
  // STATUS_ORDER is already the lifecycle order the badges and tiles use.
  [TICKET_SORTS.STATUS]: (a, b) => statusRank(a.status) - statusRank(b.status) || byActivity(a, b),
};

/**
 * A sorted copy. Never sorts in place — the same array is handed to
 * TicketSummary for its counts and split into the resolved archive, and an
 * in-place sort would reorder a list other components are already holding.
 *
 * An unrecognised sort falls back to the default rather than throwing: the
 * value arrives from the query string, where anyone can type anything.
 */
export function sortTickets(tickets, sort = DEFAULT_SORT) {
  const compare = COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT];
  return [...tickets].sort(compare);
}

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

/**
 * A client refusing a resolution.
 *
 * The only status change a client can make, and only this one: `resolved` back
 * to `open`, on a ticket they raised. It is a separate question from
 * `canManageTickets` on purpose — widening that would hand clients the whole
 * status dropdown, and this is one specific transition, not a promotion.
 *
 * Deliberately unlimited. `canEscalate` is once-only because escalation climbs
 * a finite hierarchy; a genuinely unfixed problem can legitimately come back
 * more than once, and a client out of reopens has no route left inside the app.
 */
export function canReopen(role, ticket, userId) {
  if (!ticket || !userId) return false;

  return (
    role === ROLES.CLIENT &&
    ticket.clientId === userId &&
    ticket.status === TICKET_STATUSES.RESOLVED
  );
}

/**
 * Whether a ticket has dropped out of the active list into the resolved
 * archive.
 *
 * Note there is no `archived` column: `status === 'resolved'` already carries
 * that fact, and a second field that could disagree with it would only invent a
 * question about which one wins. Archiving is a *view*, so this is a predicate
 * rather than state.
 *
 * Unread replies keep a ticket out of the archive. Otherwise marking something
 * resolved would bury the conversation on it, and an agency writing to a
 * resolved ticket would be talking into a drawer nobody opens.
 */
export const isArchived = (ticket) =>
  ticket?.status === TICKET_STATUSES.RESOLVED && !(ticket?.unreadCount > 0);

/**
 * An escalation that is still outstanding, rather than one that merely happened.
 *
 * `escalated_at` is never cleared — it is a record of what the ticket went
 * through, so on its own it stays true forever. Counting it raw made the
 * summary's Escalated tile keep a resolved ticket in a red count, reading as
 * work still waiting on an admin long after it was finished.
 */
export const hasOpenEscalation = (ticket) =>
  Boolean(ticket?.escalatedAt) && ticket?.status !== TICKET_STATUSES.RESOLVED;

/**
 * A ticket that came back after being resolved, and has not been resolved
 * again since.
 *
 * Same shape as `hasOpenEscalation`, and for the same reason: `reopened_at` is
 * never cleared, so the raw field would keep claiming a ticket was in dispute
 * long after it was settled.
 *
 * This is what stops a returning problem reading as a brand new one. A ticket
 * somebody has already worked once is usually a smaller job than it looks.
 */
export const isReopened = (ticket) =>
  Boolean(ticket?.reopenedAt) && ticket?.status !== TICKET_STATUSES.RESOLVED;

// --------------------------------------------------------------------------
// Messages
//
// Each ticket carries a thread between the client who raised it and the agency
// working it. An admin joins only once the ticket has been escalated to them.
// --------------------------------------------------------------------------

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * What a message is. Mirrors `ticket_messages_kind_check` in schema.sql.
 *
 * Unlike the status/department/urgency enums these are a check constraint
 * rather than a Postgres type, so adding one here needs a matching edit to that
 * constraint — but no `alter type` migration.
 */
export const MESSAGE_KINDS = {
  MESSAGE: 'message',
  REOPEN: 'reopen',
};

/** A reopen reason, which the thread renders as an event rather than a reply. */
export const isReopenNotice = (message) => message?.kind === MESSAGE_KINDS.REOPEN;

/**
 * Validates a message body, the way PASSWORD_RULES validates a password: one
 * definition driving the composer's disabled state *and* the server's 400, so
 * the two cannot disagree about what counts as sendable.
 *
 * Returns the trimmed text as well, so both tiers store and measure the same
 * string rather than each trimming it slightly differently.
 */
export function checkMessage(value) {
  const body = String(value ?? '').trim();

  if (!body) return { valid: false, body, error: 'Write a message before sending.' };

  if (body.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      body,
      error: `Keep it under ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }

  return { valid: true, body, error: null };
}

/**
 * Whether a ticket's thread still takes messages.
 *
 * Resolving closes it. Otherwise a resolved ticket stays a live inbox: anyone
 * could keep posting, every message would raise an unread badge, and because
 * unread pulls a ticket back out of the archive, chatting would quietly become
 * a second way to reopen work — one that leaves the status reading "resolved"
 * while the ticket sits in the active list.
 *
 * So there is exactly one way back: `canReopen`, which asks for a reason and
 * actually moves the status. Reopening reopens the conversation with it.
 */
export const isConversationOpen = (ticket) =>
  Boolean(ticket) && ticket.status !== TICKET_STATUSES.RESOLVED;

/**
 * Who may post into a ticket's thread.
 *
 * The client and their agency always can. An admin can only once the ticket has
 * been escalated *to them* — an admin browsing an agency's tickets can read the
 * conversation for oversight, but escalation is what invites them into it.
 *
 * Deliberately checks identity as well as role, so the answer is complete on
 * its own rather than assuming a caller has already scoped the ticket.
 */
export function canPostMessage(role, ticket, userId) {
  if (!ticket || !userId) return false;
  if (!isConversationOpen(ticket)) return false;

  if (role === ROLES.CLIENT) return ticket.clientId === userId;
  if (role === ROLES.AGENCY) return ticket.agencyId === userId;
  if (role === ROLES.ADMIN) return Boolean(ticket.escalatedAt) && ticket.escalatedTo === userId;

  return false;
}

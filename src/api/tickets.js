// ---------------------------------------------------------------------------
// The ticket API.
//
// Same boundary rule as src/api/auth.js: this is the only place the browser
// touches the tickets table, so moving to the real API server means rewriting
// this file as `fetch` calls and nothing above it changes.
//
// Every function re-resolves the acting user from the session rather than
// trusting a caller-supplied id, and every read and write is scoped to what that
// user is allowed to see. At this stage those checks run in the browser, so they
// are a UX guarantee rather than a security boundary — the interim RLS policies
// on tickets are wide open.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase';
import { getCurrentUser } from './auth';
import { ROLES } from '../lib/roles';
import { isDepartment, isStatus, isUrgency } from '../lib/tickets';

const TICKET_FIELDS =
  'id, subject, description, department, urgency, status, client_id, agency_id, escalated_at, escalated_to, created_at, updated_at';

export class TicketError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'TicketError';
    this.field = field;
  }
}

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

async function requireActor() {
  const actor = await getCurrentUser();
  if (!actor) throw new TicketError(SESSION_EXPIRED);
  return actor;
}

function toTicket(row, client = null) {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    department: row.department,
    urgency: row.urgency,
    status: row.status,
    clientId: row.client_id,
    agencyId: row.agency_id,
    escalatedAt: row.escalated_at ?? null,
    escalatedTo: row.escalated_to ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    client: client ? { id: client.id, fullName: client.full_name, email: client.email } : null,
  };
}

/**
 * Attaches the raising client to each row.
 *
 * Done as a second query rather than a PostgREST embed because tickets has
 * three separate foreign keys into users, which makes the embed syntax
 * ambiguous and brittle. Two plain queries are easier to reason about.
 */
async function withClients(rows) {
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((row) => row.client_id))];
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email')
    .in('id', ids);

  if (error) throw new TicketError('Could not load ticket details. Please try again.');

  const byId = new Map(data.map((user) => [user.id, user]));
  return rows.map((row) => toTicket(row, byId.get(row.client_id) ?? null));
}

const newestFirst = (query) => query.order('created_at', { ascending: false });

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

/** Tickets the signed-in client raised. */
export async function listMyTickets() {
  const actor = await requireActor();
  if (actor.role !== ROLES.CLIENT) {
    throw new TicketError('Only clients have their own tickets.');
  }

  const { data, error } = await newestFirst(
    supabase.from('tickets').select(TICKET_FIELDS).eq('client_id', actor.id)
  );

  if (error) throw new TicketError('Could not load your tickets. Please try again.');
  return withClients(data);
}

/** Tickets raised by the signed-in agency's clients. */
export async function listAgencyTickets() {
  const actor = await requireActor();
  if (actor.role !== ROLES.AGENCY) {
    throw new TicketError('Only agencies have a client queue.');
  }

  const { data, error } = await newestFirst(
    supabase.from('tickets').select(TICKET_FIELDS).eq('agency_id', actor.id)
  );

  if (error) throw new TicketError('Could not load tickets. Please try again.');
  return withClients(data);
}

/** Tickets escalated to the signed-in admin. */
export async function listEscalatedTickets() {
  const actor = await requireActor();
  if (actor.role !== ROLES.ADMIN) {
    throw new TicketError('Only admins receive escalations.');
  }

  const { data, error } = await newestFirst(
    supabase.from('tickets').select(TICKET_FIELDS).eq('escalated_to', actor.id)
  );

  if (error) throw new TicketError('Could not load escalated tickets. Please try again.');
  return withClients(data);
}

/**
 * Tickets belonging to one of the signed-in admin's agencies — the "browse by
 * agency" view. Refuses agencies that are not the admin's own.
 */
export async function listTicketsForAgency(agencyId) {
  const actor = await requireActor();
  if (actor.role !== ROLES.ADMIN) {
    throw new TicketError('Only admins can browse by agency.');
  }
  if (!agencyId) throw new TicketError('Choose an agency.');

  const { data: agency, error: agencyError } = await supabase
    .from('users')
    .select('id, parent_id')
    .eq('id', agencyId)
    .maybeSingle();

  if (agencyError) throw new TicketError('Could not load tickets. Please try again.');
  if (!agency || agency.parent_id !== actor.id) {
    throw new TicketError('That agency is not one of yours.');
  }

  const { data, error } = await newestFirst(
    supabase.from('tickets').select(TICKET_FIELDS).eq('agency_id', agencyId)
  );

  if (error) throw new TicketError('Could not load tickets. Please try again.');
  return withClients(data);
}

/**
 * True when `actor` may see `row`.
 *
 * Clients see their own. Agencies see their clients'. Admins see anything
 * escalated to them, plus anything belonging to an agency they own — which is
 * the one case needing a further lookup.
 */
async function canView(actor, row) {
  if (actor.role === ROLES.CLIENT) return row.client_id === actor.id;
  if (actor.role === ROLES.AGENCY) return row.agency_id === actor.id;

  if (actor.role === ROLES.ADMIN) {
    if (row.escalated_to === actor.id) return true;

    const { data } = await supabase
      .from('users')
      .select('parent_id')
      .eq('id', row.agency_id)
      .maybeSingle();

    return data?.parent_id === actor.id;
  }

  return false;
}

/** A single ticket, or a refusal if it is not the actor's to see. */
export async function getTicket(ticketId) {
  const actor = await requireActor();

  const { data, error } = await supabase
    .from('tickets')
    .select(TICKET_FIELDS)
    .eq('id', ticketId)
    .maybeSingle();

  if (error) throw new TicketError('Could not load the ticket. Please try again.');
  // Same message either way, so a wrong id cannot be used to confirm that some
  // other agency's ticket exists.
  if (!data || !(await canView(actor, data))) {
    throw new TicketError('That ticket could not be found.');
  }

  const [ticket] = await withClients([data]);
  return ticket;
}

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------

/**
 * Raise a ticket. Clients only — the agency is taken from the client's parent,
 * never from the form, so a ticket cannot be aimed at someone else's agency.
 */
export async function createTicket({ subject, department, description, urgency }) {
  const actor = await requireActor();

  if (actor.role !== ROLES.CLIENT) {
    throw new TicketError('Only client accounts can raise tickets.');
  }
  if (!actor.parentId) {
    throw new TicketError('Your account is not linked to an agency yet.');
  }

  const trimmedSubject = String(subject ?? '').trim();
  const trimmedDescription = String(description ?? '').trim();

  if (!trimmedSubject) throw new TicketError('Enter a subject.', 'subject');
  if (trimmedSubject.length > 150) {
    throw new TicketError('Keep the subject under 150 characters.', 'subject');
  }
  if (!isDepartment(department)) throw new TicketError('Choose a department.', 'department');
  if (!trimmedDescription) throw new TicketError('Describe the problem.', 'description');
  if (!isUrgency(urgency)) throw new TicketError('Choose an urgency.', 'urgency');

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      subject: trimmedSubject,
      description: trimmedDescription,
      department,
      urgency,
      client_id: actor.id,
      agency_id: actor.parentId,
    })
    .select(TICKET_FIELDS)
    .single();

  if (error) throw new TicketError('Could not raise the ticket. Please try again.');

  const [ticket] = await withClients([data]);
  return ticket;
}

/** Move a ticket's status. Agencies and admins only, within their own scope. */
export async function updateTicketStatus(ticketId, status) {
  const actor = await requireActor();

  if (actor.role === ROLES.CLIENT) {
    throw new TicketError('Only your agency can change a ticket status.');
  }
  if (!isStatus(status)) throw new TicketError('Choose a valid status.', 'status');

  // Re-reads through getTicket so the same access rules apply to the write.
  await getTicket(ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .select(TICKET_FIELDS)
    .single();

  if (error) throw new TicketError('Could not update the ticket. Please try again.');

  const [ticket] = await withClients([data]);
  return ticket;
}

/**
 * Raise a ticket to the agency's admin.
 *
 * A request for help, not a handover — the agency keeps working the ticket
 * afterwards, and both it and the admin can still change the status.
 */
export async function escalateTicket(ticketId) {
  const actor = await requireActor();

  if (actor.role !== ROLES.AGENCY) {
    throw new TicketError('Only an agency can escalate a ticket.');
  }
  if (!actor.parentId) {
    throw new TicketError('Your agency is not linked to an admin yet.');
  }

  const existing = await getTicket(ticketId);
  if (existing.escalatedAt) {
    throw new TicketError('That ticket has already been escalated.');
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({
      escalated_at: new Date().toISOString(),
      escalated_to: actor.parentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .select(TICKET_FIELDS)
    .single();

  if (error) throw new TicketError('Could not escalate the ticket. Please try again.');

  const [ticket] = await withClients([data]);
  return ticket;
}

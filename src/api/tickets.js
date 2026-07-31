// ---------------------------------------------------------------------------
// The ticket API — client half.
//
// Thin calls to the Express server in /server. Scoping (which tickets a role may
// see) and validation both live there; a caller cannot widen what it is allowed
// to read by editing this file.
// ---------------------------------------------------------------------------

import { HttpError, createClient } from '../lib/http';

export class TicketError extends HttpError {
  constructor(message, options) {
    super(message, options);
    this.name = 'TicketError';
  }
}

const request = createClient(TicketError);

/** Tickets the signed-in client raised. */
export async function listMyTickets() {
  const { tickets } = await request('/tickets/mine');
  return tickets;
}

/** Tickets raised by the signed-in agency's clients. */
export async function listAgencyTickets() {
  const { tickets } = await request('/tickets/agency');
  return tickets;
}

/** Tickets escalated to the signed-in admin. */
export async function listEscalatedTickets() {
  const { tickets } = await request('/tickets/escalated');
  return tickets;
}

/** Tickets belonging to one of the signed-in admin's agencies. */
export async function listTicketsForAgency(agencyId) {
  if (!agencyId) throw new TicketError('Choose an agency.');
  const { tickets } = await request(`/tickets/by-agency/${encodeURIComponent(agencyId)}`);
  return tickets;
}

/** A single ticket, or a refusal if it is not the caller's to see. */
export async function getTicket(ticketId) {
  const { ticket } = await request(`/tickets/${encodeURIComponent(ticketId)}`);
  return ticket;
}

/** Raise a ticket. The agency is taken from the client's parent, server-side. */
export async function createTicket({ subject, department, description, urgency }) {
  const { ticket } = await request('/tickets', {
    method: 'POST',
    body: { subject, department, description, urgency },
  });
  return ticket;
}

/** Move a ticket's status. */
export async function updateTicketStatus(ticketId, status) {
  const { ticket } = await request(`/tickets/${encodeURIComponent(ticketId)}/status`, {
    method: 'PATCH',
    body: { status },
  });
  return ticket;
}

/** Raise a ticket to the agency's admin. */
export async function escalateTicket(ticketId) {
  const { ticket } = await request(`/tickets/${encodeURIComponent(ticketId)}/escalate`, {
    method: 'POST',
  });
  return ticket;
}

/**
 * Refuse a resolution and ask for more help. Clients only, and only on a
 * resolved ticket. The reason is posted into the conversation.
 */
export async function reopenTicket(ticketId, reason) {
  const { ticket } = await request(`/tickets/${encodeURIComponent(ticketId)}/reopen`, {
    method: 'POST',
    body: { reason },
  });
  return ticket;
}

/** A ticket's whole conversation, oldest first. */
export async function listTicketMessages(ticketId) {
  const { messages } = await request(`/tickets/${encodeURIComponent(ticketId)}/messages`);
  return messages;
}

/**
 * Post to a ticket's conversation. The author is taken from the session, so a
 * message cannot be sent as somebody else.
 */
export async function postTicketMessage(ticketId, body) {
  const { message } = await request(`/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: { body },
  });
  return message;
}

/**
 * Mark a ticket's conversation read up to now, clearing its unread badge.
 * Idempotent, and safe to call on every poll that brings something new.
 */
export async function markTicketRead(ticketId) {
  await request(`/tickets/${encodeURIComponent(ticketId)}/read`, { method: 'POST' });
}

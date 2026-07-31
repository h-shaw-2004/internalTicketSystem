import { Router } from 'express';
import { many, one, query } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { requireAuth, requireRole } from '../session.js';
import { ROLES } from '../../shared/roles.js';
import {
  MESSAGE_KINDS,
  TICKET_STATUSES,
  canPostMessage,
  canReopen,
  checkMessage,
  isConversationOpen,
  isDepartment,
  isStatus,
  isUrgency,
} from '../../shared/tickets.js';

const router = Router();

router.use(requireAuth);

/**
 * Every ticket read, from the point of view of one person.
 *
 * The raising client comes back on every row so the lists can name them without
 * a second round trip, and so does `unread_count` — messages somebody *else*
 * wrote since this viewer last opened the ticket. Both ride on the one query,
 * so a list with unread badges still costs a single request.
 *
 * `viewer` is a placeholder name (`'$1'`), never a value — the id is still
 * bound by pg. It is a parameter rather than a fixed `$1` because
 * /by-agency/:agencyId filters on an id that is *not* the viewer's, so the two
 * cannot share a position.
 */
const ticketSelect = (viewer) => `
  select t.id, t.subject, t.description, t.department, t.urgency, t.status,
         t.client_id, t.agency_id, t.escalated_at, t.escalated_to,
         t.reopened_at, t.created_at, t.updated_at,
         c.full_name as client_full_name, c.email as client_email,
         (select count(*)
            from ticket_messages m
           where m.ticket_id = t.id
             -- Your own replies are never unread to you.
             and m.author_id <> ${viewer}
             and (r.last_read_at is null or m.created_at > r.last_read_at)
         )::int as unread_count
    from tickets t
    join users c on c.id = t.client_id
    -- Missing row = never opened, so everything on it counts as unread.
    left join ticket_reads r on r.ticket_id = t.id and r.user_id = ${viewer}`;

const NEWEST_FIRST = 'order by t.created_at desc';

// The author comes back with every message for the same reason the client comes
// back with every ticket — the thread names people, and one join beats N.
const MESSAGE_SELECT = `
  select m.id, m.ticket_id, m.author_id, m.author_role, m.body, m.kind, m.created_at,
         a.full_name as author_full_name, a.email as author_email
    from ticket_messages m
    join users a on a.id = m.author_id`;

function toTicket(row) {
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
    reopenedAt: row.reopened_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Relative to whoever asked — the same ticket is a different number to the
    // client, their agency and the admin.
    unreadCount: row.unread_count ?? 0,
    client: {
      id: row.client_id,
      fullName: row.client_full_name,
      email: row.client_email,
    },
  };
}

function toMessage(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    body: row.body,
    kind: row.kind,
    createdAt: row.created_at,
    authorId: row.author_id,
    // The role recorded when the message was sent, not the author's role today.
    authorRole: row.author_role,
    author: {
      id: row.author_id,
      fullName: row.author_full_name,
      email: row.author_email,
    },
  };
}

/**
 * Loads a ticket the caller is allowed to see, or 404s.
 *
 * A forbidden ticket and a non-existent one give the same answer, so the
 * endpoint cannot be used to confirm that another agency's ticket exists.
 */
async function loadVisible(user, ticketId) {
  const row = await one(`${ticketSelect('$1')} where t.id = $2`, [user.id, ticketId]);
  if (!row) throw notFound('That ticket could not be found.');

  const ticket = toTicket(row);

  if (user.role === ROLES.CLIENT && ticket.clientId === user.id) return ticket;
  if (user.role === ROLES.AGENCY && ticket.agencyId === user.id) return ticket;

  if (user.role === ROLES.ADMIN) {
    if (ticket.escalatedTo === user.id) return ticket;

    // Otherwise it has to belong to an agency this admin owns.
    const agency = await one('select parent_id from users where id = $1', [ticket.agencyId]);
    if (agency?.parent_id === user.id) return ticket;
  }

  throw notFound('That ticket could not be found.');
}

// Specific paths first — '/mine' would otherwise be captured by '/:id'.

/** A client's own tickets. */
router.get('/mine', requireRole(ROLES.CLIENT), async (req, res) => {
  // Viewer and filter are the same person here, so both read $1.
  const rows = await many(`${ticketSelect('$1')} where t.client_id = $1 ${NEWEST_FIRST}`, [
    req.user.id,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

/** Everything raised by an agency's clients. */
router.get('/agency', requireRole(ROLES.AGENCY), async (req, res) => {
  const rows = await many(`${ticketSelect('$1')} where t.agency_id = $1 ${NEWEST_FIRST}`, [
    req.user.id,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

/** An admin's escalation queue. */
router.get('/escalated', requireRole(ROLES.ADMIN), async (req, res) => {
  const rows = await many(`${ticketSelect('$1')} where t.escalated_to = $1 ${NEWEST_FIRST}`, [
    req.user.id,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

/** Browse by agency — refuses agencies the admin does not own. */
router.get('/by-agency/:agencyId', requireRole(ROLES.ADMIN), async (req, res) => {
  const { agencyId } = req.params;

  const agency = await one('select id, parent_id from users where id = $1', [agencyId]);
  if (!agency || agency.parent_id !== req.user.id) {
    throw forbidden('That agency is not one of yours.');
  }

  // The one place the viewer and the filter are different people.
  const rows = await many(`${ticketSelect('$1')} where t.agency_id = $2 ${NEWEST_FIRST}`, [
    req.user.id,
    agencyId,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

router.get('/:id', async (req, res) => {
  res.json({ ticket: await loadVisible(req.user, req.params.id) });
});

/**
 * Raise a ticket. Clients only — the agency comes from the client's parent, so a
 * ticket cannot be aimed at somebody else's agency.
 */
router.post('/', requireRole(ROLES.CLIENT), async (req, res) => {
  const { user } = req;
  if (!user.parentId) throw badRequest('Your account is not linked to an agency yet.');

  const subject = String(req.body?.subject ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  const { department, urgency } = req.body ?? {};

  if (!subject) throw badRequest('Enter a subject.', 'subject');
  if (subject.length > 150) throw badRequest('Keep the subject under 150 characters.', 'subject');
  if (!isDepartment(department)) throw badRequest('Choose a department.', 'department');
  if (!description) throw badRequest('Describe the problem.', 'description');
  if (!isUrgency(urgency)) throw badRequest('Choose an urgency.', 'urgency');

  const inserted = await one(
    `insert into tickets (subject, description, department, urgency, client_id, agency_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [subject, description, department, urgency, user.id, user.parentId]
  );

  const row = await one(`${ticketSelect('$1')} where t.id = $2`, [user.id, inserted.id]);
  res.status(201).json({ ticket: toTicket(row) });
});

router.patch('/:id/status', requireRole(ROLES.AGENCY, ROLES.ADMIN), async (req, res) => {
  const { status } = req.body ?? {};
  if (!isStatus(status)) throw badRequest('Choose a valid status.', 'status');

  // Re-uses the read rules so the write is scoped identically.
  await loadVisible(req.user, req.params.id);

  await one('update tickets set status = $1, updated_at = now() where id = $2 returning id', [
    status,
    req.params.id,
  ]);

  res.json({ ticket: await loadVisible(req.user, req.params.id) });
});

/**
 * Escalate to the agency's admin. A request for help, not a handover — the
 * agency keeps working the ticket and both can still change its status.
 */
router.post('/:id/escalate', requireRole(ROLES.AGENCY), async (req, res) => {
  const { user } = req;
  if (!user.parentId) throw badRequest('Your agency is not linked to an admin yet.');

  const ticket = await loadVisible(user, req.params.id);
  if (ticket.escalatedAt) throw badRequest('That ticket has already been escalated.');

  await one(
    `update tickets
        set escalated_at = now(), escalated_to = $1, updated_at = now()
      where id = $2
      returning id`,
    [user.parentId, req.params.id]
  );

  res.json({ ticket: await loadVisible(user, req.params.id) });
});

/**
 * A client refusing a resolution.
 *
 * Its own route rather than a widening of PATCH /:id/status, which keeps that
 * route's requireRole(AGENCY, ADMIN) intact — a client gets exactly one
 * transition, resolved -> open, and never the whole status dropdown.
 *
 * The reason is mandatory and becomes a message in the thread, so "why is this
 * back" is answered where people are already reading, and the agency finds out
 * through the unread badge rather than through a notification path of its own.
 */
router.post('/:id/reopen', requireRole(ROLES.CLIENT), async (req, res) => {
  const { user } = req;

  const ticket = await loadVisible(user, req.params.id);

  if (!canReopen(user.role, ticket, user.id)) {
    throw badRequest('That ticket is not resolved, so there is nothing to reopen.');
  }

  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) {
    throw badRequest(
      'Say what is still wrong, so your agency knows what to pick up.',
      'reason'
    );
  }

  const { valid, body, error } = checkMessage(reason);
  if (!valid) throw badRequest(error, 'reason');

  // One statement, so a ticket can never come back with no explanation on it,
  // and reopened_at can never disagree with the notice in the thread.
  await one(
    `with new_message as (
       insert into ticket_messages (ticket_id, author_id, author_role, body, kind)
       values ($1, $2, $3, $4, $5)
       returning id
     ), reopened as (
       update tickets
          set status = $6, reopened_at = now(), updated_at = now()
        where id = $1
     )
     select id from new_message`,
    [ticket.id, user.id, user.role, body, MESSAGE_KINDS.REOPEN, TICKET_STATUSES.OPEN]
  );

  res.json({ ticket: await loadVisible(user, req.params.id) });
});

// --------------------------------------------------------------------------
// Messages
//
// Reading a thread is scoped by loadVisible, exactly like reading the ticket —
// if you can see the ticket you can follow the conversation on it, which keeps
// an admin's browse-by-agency view useful for oversight.
//
// Posting narrows that further with canPostMessage: an admin has to have had
// the ticket escalated to them. So the write can never reach a thread the read
// could not, and an admin browsing is a reader until they are invited in.
// --------------------------------------------------------------------------

/**
 * Why a post was refused. `canPostMessage` stays the single gate; this only
 * explains its answer, so the two cannot drift into disagreeing.
 */
function refusalMessage(role, ticket) {
  if (!isConversationOpen(ticket)) {
    return role === ROLES.CLIENT
      ? 'This ticket is resolved. Reopen it if the problem is still there.'
      : 'This ticket is resolved, so its conversation is closed.';
  }

  if (role === ROLES.ADMIN) {
    return 'You can join this conversation once the ticket has been escalated to you.';
  }

  return 'You cannot post to this conversation.';
}

/** The whole thread, oldest first — the order it is read in. */
router.get('/:id/messages', async (req, res) => {
  await loadVisible(req.user, req.params.id);

  const rows = await many(`${MESSAGE_SELECT} where m.ticket_id = $1 order by m.created_at asc`, [
    req.params.id,
  ]);

  res.json({ messages: rows.map(toMessage) });
});

/** Post to the thread. Author and role both come from the session. */
router.post('/:id/messages', async (req, res) => {
  const { user } = req;

  const ticket = await loadVisible(user, req.params.id);

  if (!canPostMessage(user.role, ticket, user.id)) {
    throw forbidden(refusalMessage(user.role, ticket));
  }

  const { valid, body, error } = checkMessage(req.body?.body);
  if (!valid) throw badRequest(error, 'body');

  // One statement, so a message can never be stored without the ticket's
  // "last updated" moving with it — a reply is activity on the ticket.
  const inserted = await one(
    `with new_message as (
       insert into ticket_messages (ticket_id, author_id, author_role, body)
       values ($1, $2, $3, $4)
       returning id
     ), touched as (
       update tickets set updated_at = now() where id = $1
     )
     select id from new_message`,
    [ticket.id, user.id, user.role, body]
  );

  const row = await one(`${MESSAGE_SELECT} where m.id = $1`, [inserted.id]);
  res.status(201).json({ message: toMessage(row) });
});

/**
 * Mark the thread read up to now, for whoever is asking.
 *
 * Scoped by loadVisible like everything else, so you cannot record a read
 * against a ticket you cannot see. Idempotent — the page calls it again every
 * time a poll brings something new, which is what stops a message that arrives
 * while you are reading from showing as unread when you go back to the list.
 */
router.post('/:id/read', async (req, res) => {
  const ticket = await loadVisible(req.user, req.params.id);

  await query(
    `insert into ticket_reads (ticket_id, user_id, last_read_at)
     values ($1, $2, now())
     on conflict (ticket_id, user_id) do update set last_read_at = now()`,
    [ticket.id, req.user.id]
  );

  res.status(204).end();
});

export default router;

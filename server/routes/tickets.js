import { Router } from 'express';
import { many, one } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { requireAuth, requireRole } from '../session.js';
import { ROLES } from '../../shared/roles.js';
import { isDepartment, isStatus, isUrgency } from '../../shared/tickets.js';

const router = Router();

router.use(requireAuth);

// The raising client comes back on every read, so the lists can name them
// without a second round trip.
const TICKET_SELECT = `
  select t.id, t.subject, t.description, t.department, t.urgency, t.status,
         t.client_id, t.agency_id, t.escalated_at, t.escalated_to,
         t.created_at, t.updated_at,
         c.full_name as client_full_name, c.email as client_email
    from tickets t
    join users c on c.id = t.client_id`;

const NEWEST_FIRST = 'order by t.created_at desc';

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    client: {
      id: row.client_id,
      fullName: row.client_full_name,
      email: row.client_email,
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
  const row = await one(`${TICKET_SELECT} where t.id = $1`, [ticketId]);
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
  const rows = await many(`${TICKET_SELECT} where t.client_id = $1 ${NEWEST_FIRST}`, [
    req.user.id,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

/** Everything raised by an agency's clients. */
router.get('/agency', requireRole(ROLES.AGENCY), async (req, res) => {
  const rows = await many(`${TICKET_SELECT} where t.agency_id = $1 ${NEWEST_FIRST}`, [
    req.user.id,
  ]);
  res.json({ tickets: rows.map(toTicket) });
});

/** An admin's escalation queue. */
router.get('/escalated', requireRole(ROLES.ADMIN), async (req, res) => {
  const rows = await many(`${TICKET_SELECT} where t.escalated_to = $1 ${NEWEST_FIRST}`, [
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

  const rows = await many(`${TICKET_SELECT} where t.agency_id = $1 ${NEWEST_FIRST}`, [
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

  const row = await one(`${TICKET_SELECT} where t.id = $1`, [inserted.id]);
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

export default router;

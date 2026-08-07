// ---------------------------------------------------------------------------
// Regenerates supabase/seed.sql — the fixed test accounts wired into the
// hierarchy (admin => agency => client), plus a set of demo tickets on top of
// them.
//
// Passwords are stored in the PBKDF2 format defined by shared/password.js, and
// Postgres cannot produce that format (pgcrypto has no PBKDF2), so the hashes
// have to be computed here and baked into the SQL as literals. This works
// because password.js is built on the Web Crypto API, which Node exposes with
// the same interface — the same reason it will port to the API server unchanged.
//
// Run with: npm run seed
// ---------------------------------------------------------------------------

import { webcrypto } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No crypto needed by these, so they can be imported before the polyfill below.
import {
  MESSAGE_KINDS,
  isDepartment,
  isStatus,
  isUrgency,
} from '../shared/tickets.js';

// Node 18 only exposes Web Crypto globally behind a flag; 19+ has it by default.
// Same gap src/test/setup.js papers over for jsdom.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// Imported after the polyfill so hashPassword has crypto.subtle available.
const { hashPassword } = await import('../shared/password.js');
const { checkPassword } = await import('../shared/passwordPolicy.js');

// Two branches under one admin, so the admin's "browse by agency" picker has
// something to pick between and each agency can only see its own client.
//
//   admin1
//     ├── agency1 ── client1
//     └── agency2 ── client2
//
// Parent-first order matters: each row's parent must already exist when it is
// inserted, and users_parent_fkey enforces that.
const HIERARCHY = [
  { key: 'admin1', role: 'admin', parentKey: null },
  { key: 'agency1', role: 'agency', parentKey: 'admin1' },
  { key: 'agency2', role: 'agency', parentKey: 'admin1' },
  { key: 'client1', role: 'client', parentKey: 'agency1' },
  { key: 'client2', role: 'client', parentKey: 'agency2' },
];

const roleOf = (key) => HIERARCHY.find((entry) => entry.key === key)?.role ?? null;

// "agency2" -> "Agency 2", for display names.
const titleCase = (key) =>
  key.replace(/^(.)/, (c) => c.toUpperCase()).replace(/(\d+)$/, ' $1');

// Convention, per account: <key>@email.com / <key>Password?
// The digit in the key is what satisfies the policy's number rule, so the
// password carries the same number as the name.
const accounts = HIERARCHY.map(({ key, role, parentKey }) => ({
  key,
  role,
  parentKey,
  parentRole: parentKey ? roleOf(parentKey) : null,
  email: `${key}@email.com`,
  password: `${key}Password?`,
  fullName: `${titleCase(key)} Test User`,
  parentEmail: parentKey ? `${parentKey}@email.com` : null,
}));

/** Indented tree for the file header, built from HIERARCHY so it cannot go stale. */
function treeLines() {
  const children = new Map();
  for (const account of accounts) {
    const parent = account.parentKey ?? '__root';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(account);
  }

  const lines = [];
  const walk = (key, prefix) => {
    const kids = children.get(key) ?? [];
    kids.forEach((child, index) => {
      const last = index === kids.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${child.email}`);
      walk(child.key, `${prefix}${last ? '    ' : '│   '}`);
    });
  };

  for (const root of children.get('__root') ?? []) {
    lines.push(root.email);
    walk(root.key, '');
  }

  return lines;
}

// Fails the build rather than emitting a seed that contradicts the policy the
// rest of the app enforces.
for (const { key, password } of accounts) {
  const { valid, results } = checkPassword(password);
  if (!valid) {
    const failed = results.filter((r) => !r.met).map((r) => r.label);
    throw new Error(`Seed password for ${key} breaks the policy: ${failed.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Demo tickets
//
// Enough to make every view real on a fresh database: all five statuses, all
// four urgencies, all five departments, an open escalation and a spent one, a
// reopened ticket, resolved work in both agencies' archives, and unread replies
// sitting where each role would actually find them.
//
// Both branches get tickets on purpose. agency1 must not be able to see
// agency2's, and that is only demonstrable if agency2 has any.
//
// Times are relative (`now() - interval 'N days'`), so a seed run last month
// still reads as current work rather than as an archive of stale dates.
// ---------------------------------------------------------------------------

const TICKETS = [
  {
    client: 'client1',
    subject: "Laptop won't boot after the latest update",
    description:
      "Our finance lead's laptop stops at the manufacturer logo and goes no further. It started right after Tuesday's update installed overnight. She has payroll to run this week.",
    department: 'hardware',
    urgency: 'critical',
    status: 'in_progress',
    raisedDaysAgo: 6,
    escalatedDaysAgo: 4,
    // The admin has replied but not caught up since, so the escalated queue
    // carries a badge.
    unreadFor: ['admin1'],
    messages: [
      {
        from: 'client1',
        daysAgo: 6,
        body: "Laptop won't get past the manufacturer logo since Tuesday's update. Safe mode does nothing either. Payroll runs Friday, so this is urgent.",
      },
      {
        from: 'agency1',
        daysAgo: 5,
        body: 'We have tried a safe-mode boot and rolling the update back, and neither took. The drive may be failing. Escalating to the platform admin for a hardware call.',
      },
      {
        from: 'admin1',
        daysAgo: 3,
        body: 'Picked this up. A replacement drive is on its way to you for Thursday, and the last backup restored cleanly on our bench, so nothing should be lost.',
      },
    ],
  },
  {
    client: 'client1',
    subject: 'Shared drive keeps disconnecting',
    description:
      'The shared drive drops off for everyone in the office several times a day. Reconnecting works but anything unsaved is lost.',
    department: 'network',
    urgency: 'high',
    status: 'open',
    raisedDaysAgo: 2,
    // Nobody at the agency has opened it — the queue should say so.
    unreadFor: ['agency1'],
    messages: [
      {
        from: 'client1',
        daysAgo: 2,
        body: 'The shared drive disconnects several times a day for everyone. It reconnects on its own after a minute but people are losing work in between.',
      },
      {
        from: 'client1',
        daysAgo: 1,
        body: 'Three more times since yesterday. Is anyone able to look at this today?',
      },
    ],
  },
  {
    client: 'client1',
    subject: 'New starter needs access to the CRM',
    description:
      'A new account manager starts on Monday and needs the CRM plus whichever shared inbox their team uses.',
    department: 'access',
    urgency: 'medium',
    status: 'with_client',
    raisedDaysAgo: 4,
    // The agency asked a question back, which is what `with_client` means — so
    // the unread reply belongs to the client.
    unreadFor: ['client1'],
    messages: [
      {
        from: 'client1',
        daysAgo: 4,
        body: 'New account manager starts Monday. They need the CRM and the shared inbox their team works out of.',
      },
      {
        from: 'agency1',
        daysAgo: 3,
        body: 'CRM account is created and waiting on first sign-in. Which shared inbox did you mean, sales or support? Either way we need their manager to confirm in writing.',
      },
    ],
  },
  {
    client: 'client1',
    subject: "Meeting room screen shows last week's schedule",
    description:
      'The booking panel outside the large meeting room is a week behind. Bookings made in the calendar do not reach it.',
    department: 'other',
    urgency: 'low',
    status: 'on_hold',
    raisedDaysAgo: 9,
    messages: [
      {
        from: 'client1',
        daysAgo: 9,
        // Worded to avoid the bare word "rooms": Supabase's SQL editor lints the
        // seed as text, and a plural noun in a message body gets mistaken for a
        // table name — it warned about RLS on "rooms" and offered a fix that
        // generated `alter table rooms ...`, which then failed with 42P01.
        body: 'The panel outside the big meeting room is a week behind, so people keep walking in on meetings that were booked properly.',
      },
      {
        from: 'agency1',
        daysAgo: 8,
        body: 'It is a known sync fault between the panel firmware and the room calendar. The vendor has a fix in their next release at the end of the month, so we are parking this until then rather than reimaging it twice.',
      },
    ],
  },
  {
    client: 'client1',
    subject: 'Invoicing export produced empty PDFs',
    description:
      'The month-end invoice export downloads as usual, but every PDF inside it is zero bytes.',
    department: 'software',
    urgency: 'high',
    status: 'resolved',
    raisedDaysAgo: 14,
    messages: [
      {
        from: 'client1',
        daysAgo: 14,
        body: 'Month-end invoice export runs and downloads, but all 40 PDFs in it are empty. We cannot send any of them out.',
      },
      {
        from: 'agency1',
        daysAgo: 13,
        body: 'Reproduced it. The export server had filled its disk, so every PDF was written empty without erroring. Cleared it, added an alert at 80%, and re-ran your export.',
      },
      {
        from: 'client1',
        daysAgo: 11,
        body: 'All 40 came through properly. Thanks for the quick turnaround.',
      },
    ],
  },
  {
    client: 'client1',
    subject: 'VPN drops every few minutes',
    description:
      'Anyone working from home is disconnected from the VPN every five to ten minutes.',
    department: 'network',
    urgency: 'medium',
    status: 'open',
    raisedDaysAgo: 20,
    reopenedDaysAgo: 1,
    // Reopening has no separate notification path: the reason lands in the
    // thread and the agency finds out through the badge.
    unreadFor: ['agency1'],
    messages: [
      {
        from: 'client1',
        daysAgo: 20,
        body: 'Everyone working from home is dropped off the VPN every five to ten minutes. It is unusable for calls.',
      },
      {
        from: 'agency1',
        daysAgo: 18,
        body: 'Updated the firmware on our side and rebuilt the tunnel config. It has held for 24 hours here without a drop.',
      },
      {
        from: 'client1',
        daysAgo: 1,
        kind: 'reopen',
        body: 'It was fine for a fortnight and then started again yesterday. Three people dropped mid-call this morning, so it is not fixed.',
      },
    ],
  },
  {
    client: 'client1',
    subject: 'Email stopped syncing on mobile',
    description:
      'Phones stopped pulling new mail over the weekend. Desktops are unaffected.',
    department: 'software',
    urgency: 'medium',
    status: 'resolved',
    raisedDaysAgo: 25,
    // Escalated and then resolved: the badge on this one is history, not an
    // alarm, which is the whole point of hasOpenEscalation.
    escalatedDaysAgo: 23,
    messages: [
      {
        from: 'client1',
        daysAgo: 25,
        body: 'No phone in the office has pulled new mail since Saturday. Desktops are fine, so people are stuck at their desks.',
      },
      {
        from: 'agency1',
        daysAgo: 24,
        body: 'The mail server accepts desktop clients and rejects mobile ones, which points at the mobile gateway rather than anything on your side. Escalating — that gateway is not ours to configure.',
      },
      {
        from: 'admin1',
        daysAgo: 23,
        body: 'The certificate on the mobile gateway had expired. Renewed it and pushed the new one out; phones should sync within the hour.',
      },
      {
        from: 'client1',
        daysAgo: 18,
        body: 'All syncing again. Thanks both.',
      },
    ],
  },

  // --- agency2's branch. Proof that agency1 cannot see any of this. ---
  {
    client: 'client2',
    subject: "Card reader in reception won't pair",
    description:
      'The card reader on the reception desk will not pair with the tablet that replaced the old till.',
    department: 'hardware',
    urgency: 'medium',
    status: 'open',
    raisedDaysAgo: 3,
    unreadFor: ['agency2'],
    messages: [
      {
        from: 'client2',
        daysAgo: 3,
        body: 'The card reader on reception will not pair with the new tablet. It pairs with a phone fine, so the reader itself seems alive.',
      },
      {
        from: 'client2',
        daysAgo: 2,
        body: 'Tried the reset pinhole and a fresh pairing code, no change. We are taking payments on the old machine meanwhile.',
      },
    ],
  },
  {
    client: 'client2',
    subject: 'Website contact form is silently failing',
    description:
      'Enquiries submitted through the website contact form never arrive. The form itself reports success.',
    department: 'software',
    urgency: 'critical',
    status: 'in_progress',
    raisedDaysAgo: 5,
    escalatedDaysAgo: 4,
    // Escalated and not yet answered, so the admin's queue has one ticket
    // waiting on them and one they have already replied to.
    unreadFor: ['admin1'],
    messages: [
      {
        from: 'client2',
        daysAgo: 5,
        body: 'Nothing from the website contact form has reached us this week, but the form still says "thanks, we will be in touch". We think we have lost a week of enquiries.',
      },
      {
        from: 'agency2',
        daysAgo: 4,
        body: 'The form posts correctly — the mail relay is refusing our domain, which is why it fails quietly. Escalating, as the relay is not ours to configure.',
      },
    ],
  },
  {
    client: 'client2',
    subject: 'Revoke access for a leaver',
    description:
      'Our warehouse supervisor left on Friday and still has access to everything.',
    department: 'access',
    urgency: 'low',
    status: 'resolved',
    raisedDaysAgo: 12,
    messages: [
      {
        from: 'client2',
        daysAgo: 12,
        body: 'Our warehouse supervisor left on Friday. Please revoke everything and let us know what they still had access to.',
      },
      {
        from: 'agency2',
        daysAgo: 11,
        body: 'Account disabled and all sessions revoked. They held the stock system, the shared drive and the office wifi certificate, which has been rotated. Mailbox forwards to the office manager for 30 days and then closes.',
      },
    ],
  },
];

/*
 * Fixed ids, because a ticket has no natural key — two tickets may share a
 * subject — and without one a re-seed would add a second copy of everything
 * rather than resetting what is already there.
 */
const ticketId = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const messageId = (ticket, message) =>
  `20000000-0000-4000-8000-${String(ticket).padStart(9, '0')}${String(message).padStart(3, '0')}`;

/*
 * The seed is checked against the same vocabulary and the same permission rule
 * the app uses, so a typo'd department or an admin posting into a thread it was
 * never invited to fails here rather than in Postgres — or worse, silently
 * seeding a state the app itself would refuse to create.
 *
 * Same reasoning as running checkPassword over the seed passwords above.
 */
function validateTickets() {
  const agencyOf = (key) => HIERARCHY.find((entry) => entry.key === key)?.parentKey ?? null;

  TICKETS.forEach((ticket, index) => {
    const where = `ticket ${index + 1} (${ticket.subject})`;

    if (roleOf(ticket.client) !== 'client') throw new Error(`${where}: not raised by a client`);
    if (!isDepartment(ticket.department)) throw new Error(`${where}: bad department`);
    if (!isUrgency(ticket.urgency)) throw new Error(`${where}: bad urgency`);
    if (!isStatus(ticket.status)) throw new Error(`${where}: bad status`);

    const agency = agencyOf(ticket.client);
    const admin = agencyOf(agency);
    const escalated = ticket.escalatedDaysAgo != null;

    for (const message of ticket.messages) {
      const author = message.from;
      const allowed =
        author === ticket.client || author === agency || (escalated && author === admin);

      if (!allowed) throw new Error(`${where}: ${author} could not have posted here`);
      if (message.kind && !Object.values(MESSAGE_KINDS).includes(message.kind)) {
        throw new Error(`${where}: unknown message kind ${message.kind}`);
      }
      if (message.daysAgo > ticket.raisedDaysAgo) {
        throw new Error(`${where}: a message predates the ticket`);
      }
    }
  });
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Whole days only, so `now() - interval '3 days'` stays legible in the output.
const ago = (days) => `now() - interval '${days} days'`;

// Re-seeding resets an existing row in place rather than duplicating it, so the
// account keeps its id and anything already pointing at it stays valid.
const ON_CONFLICT = `on conflict (email) do update
  set full_name            = excluded.full_name,
      password_hash        = excluded.password_hash,
      role                 = excluded.role,
      parent_id            = excluded.parent_id,
      parent_role          = excluded.parent_role,
      must_change_password = excluded.must_change_password;`;

const COLUMNS =
  '(email, full_name, password_hash, role, parent_id, parent_role, must_change_password)';

// Seeded accounts skip the forced password change so their documented
// credentials keep working. Accounts made through the app get `true`.
const MUST_CHANGE = 'false';

async function statement(a) {
  const hash = await hashPassword(a.password);
  const head = `-- ${a.key} (${a.role})${
    a.parentEmail ? ` — belongs to ${a.parentEmail}` : ' — top of the tree'
  }
insert into public.users ${COLUMNS}`;

  if (!a.parentEmail) {
    return `${head}
values (${quote(a.email)}, ${quote(a.fullName)}, ${quote(hash)}, ${quote(a.role)}, null, null, ${MUST_CHANGE})
${ON_CONFLICT}`;
  }

  // The parent's id is looked up rather than hardcoded, so this survives the
  // parent row having been created with a different uuid.
  return `${head}
select ${quote(a.email)}, ${quote(a.fullName)}, ${quote(hash)}, ${quote(a.role)}, id, ${quote(a.parentRole)}, ${MUST_CHANGE}
from public.users
where email = ${quote(a.parentEmail)}
${ON_CONFLICT}`;
}

const statements = [];
for (const a of accounts) {
  statements.push(await statement(a));
}

const emailList = accounts.map((a) => quote(a.email)).join(', ');

// ---------------------------------------------------------------------------
// Ticket SQL
//
// Every row derives its ids from the hierarchy rather than naming accounts
// directly: agency_id comes from the client's parent and escalated_to from that
// agency's parent, exactly the way POST /tickets and the escalate route do it.
// So the seed cannot produce a ticket the API would not.
// ---------------------------------------------------------------------------

validateTickets();

const TICKET_ON_CONFLICT = `on conflict (id) do update
  set subject      = excluded.subject,
      description  = excluded.description,
      department   = excluded.department,
      urgency      = excluded.urgency,
      status       = excluded.status,
      client_id    = excluded.client_id,
      agency_id    = excluded.agency_id,
      escalated_at = excluded.escalated_at,
      escalated_to = excluded.escalated_to,
      reopened_at  = excluded.reopened_at,
      created_at   = excluded.created_at,
      updated_at   = excluded.updated_at;`;

const ticketStatements = TICKETS.map((ticket, index) => {
  const id = ticketId(index + 1);
  const email = `${ticket.client}@email.com`;

  // Posting bumps updated_at in the same statement as the insert, so the newest
  // message *is* the ticket's last activity. Derived rather than written down,
  // so the two cannot drift apart in the seed either.
  const lastActivity = Math.min(
    ticket.raisedDaysAgo,
    ...ticket.messages.map((message) => message.daysAgo)
  );

  const escalation = ticket.escalatedDaysAgo != null;

  return `-- ${index + 1}. ${ticket.subject} — ${ticket.client}, ${ticket.status}${
    escalation ? ', escalated' : ''
  }${ticket.reopenedDaysAgo != null ? ', reopened' : ''}
insert into public.tickets
  (id, subject, description, department, urgency, status,
   client_id, agency_id, escalated_at, escalated_to, reopened_at, created_at, updated_at)
select ${quote(id)}, ${quote(ticket.subject)}, ${quote(ticket.description)},
       ${quote(ticket.department)}, ${quote(ticket.urgency)}, ${quote(ticket.status)},
       c.id, a.id,
       ${escalation ? ago(ticket.escalatedDaysAgo) : 'null'},
       ${escalation ? 'a.parent_id' : 'null'},
       ${ticket.reopenedDaysAgo != null ? ago(ticket.reopenedDaysAgo) : 'null'},
       ${ago(ticket.raisedDaysAgo)}, ${ago(lastActivity)}
from public.users c
join public.users a on a.id = c.parent_id
where c.email = ${quote(email)}
${TICKET_ON_CONFLICT}`;
});

const MESSAGE_ON_CONFLICT = `on conflict (id) do update
  set ticket_id   = excluded.ticket_id,
      author_id   = excluded.author_id,
      author_role = excluded.author_role,
      body        = excluded.body,
      kind        = excluded.kind,
      created_at  = excluded.created_at;`;

const messageStatements = TICKETS.flatMap((ticket, ticketIndex) =>
  ticket.messages.map((message, messageIndex) => {
    const id = messageId(ticketIndex + 1, messageIndex + 1);

    // author_role is stored on the message rather than joined from users, so a
    // later promotion cannot rewrite how an old message was attributed. The
    // seed writes the role the author holds now, which is the same thing.
    return `insert into public.ticket_messages (id, ticket_id, author_id, author_role, body, kind, created_at)
select ${quote(id)}, ${quote(ticketId(ticketIndex + 1))}, u.id, ${quote(roleOf(message.from))},
       ${quote(message.body)}, ${quote(message.kind ?? 'message')}, ${ago(message.daysAgo)}
from public.users u
where u.email = ${quote(`${message.from}@email.com`)}
${MESSAGE_ON_CONFLICT}`;
  })
);

/*
 * Read state, which is what decides where an unread badge appears.
 *
 * Everyone who can see a ticket is marked as caught up except the accounts
 * listed in `unreadFor`. Without this every seeded ticket would badge for
 * everybody — no row means never opened, so the whole thread counts as unread —
 * and, because unread pulls a ticket out of the archive, nothing resolved would
 * ever collapse into it.
 */
const readStatements = TICKETS.flatMap((ticket, index) => {
  const agency = HIERARCHY.find((entry) => entry.key === ticket.client)?.parentKey;
  const admin = HIERARCHY.find((entry) => entry.key === agency)?.parentKey;

  const caughtUp = [ticket.client, agency, admin].filter(
    (key) => !(ticket.unreadFor ?? []).includes(key)
  );

  if (caughtUp.length === 0) return [];

  const emails = caughtUp.map((key) => quote(`${key}@email.com`)).join(', ');

  return [
    `-- ${index + 1}. read by ${caughtUp.join(', ')}${
      ticket.unreadFor?.length ? ` — unread for ${ticket.unreadFor.join(', ')}` : ''
    }
insert into public.ticket_reads (ticket_id, user_id, last_read_at)
select ${quote(ticketId(index + 1))}, u.id, now()
from public.users u
where u.email in (${emails})
on conflict (ticket_id, user_id) do update
  set last_read_at = excluded.last_read_at;`,
  ];
});

// Anyone who is *meant* to have an unread badge must have no read row at all —
// including a stale one left by an earlier seed that marked them caught up.
const unreadResets = TICKETS.flatMap((ticket, index) =>
  (ticket.unreadFor ?? []).map(
    (key) => `delete from public.ticket_reads
where ticket_id = ${quote(ticketId(index + 1))}
  and user_id in (select id from public.users where email = ${quote(`${key}@email.com`)});`
  )
);

const seededTicketIds = TICKETS.map((_, index) => quote(ticketId(index + 1))).join(', ');
const seededMessageIds = TICKETS.flatMap((ticket, ticketIndex) =>
  ticket.messages.map((_, messageIndex) => quote(messageId(ticketIndex + 1, messageIndex + 1)))
).join(', ');

const sql = `-- Internal Ticket System — test accounts and demo tickets.
-- GENERATED FILE — edit scripts/generate-seed.mjs and run \`npm run seed\`.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. The editor runs as the
-- postgres role, which bypasses RLS — that is the point. There is no public
-- sign-up: agencies are created by an admin and clients by an agency, so the
-- first admin has to come from here.
--
-- Hierarchy created:
${treeLines()
  .map((line) => `--   ${line}`)
  .join('\n')}
--
-- Credentials (local development only — these passwords are trivially
-- guessable, never run this against anything real):
${accounts
  .map((a) => `--   ${a.role.padEnd(6)} ${a.email.padEnd(20)} ${a.password}`)
  .join('\n')}
--
-- Tickets created (dates are relative to when this runs, so they never go
-- stale). Between them they cover every status, urgency and department, an open
-- escalation and a spent one, a reopened ticket, resolved work in both agencies'
-- archives, and unread replies waiting for each role:
${TICKETS.map((ticket, index) => {
  const flags = [
    ticket.status,
    ticket.escalatedDaysAgo != null ? 'escalated' : null,
    ticket.reopenedDaysAgo != null ? 'reopened' : null,
    ticket.unreadFor?.length ? `unread for ${ticket.unreadFor.join(', ')}` : null,
  ].filter(Boolean);

  return `--   ${String(index + 1).padStart(2)}. ${ticket.client}  ${ticket.subject}
--       ${flags.join(' · ')}`;
}).join('\n')}
--
-- Safe to re-run: every row below has a fixed id and is reset in place rather
-- than duplicated. Note that re-running restores the demo tickets exactly as
-- listed above — replies you added by hand to a seeded ticket are removed.

${statements.join('\n\n')}

-- --------------------------------------------------------------------------
-- Tickets
--
-- agency_id comes from the client's own parent and escalated_to from that
-- agency's parent, the same way POST /tickets and the escalate route derive
-- them. Nothing here names an agency directly, so the seed cannot create a
-- ticket the API would refuse to.
-- --------------------------------------------------------------------------

${ticketStatements.join('\n\n')}

-- --------------------------------------------------------------------------
-- Conversations
-- --------------------------------------------------------------------------

${messageStatements.join('\n\n')}

-- Replies added by hand to a seeded ticket, from an earlier run or from using
-- the app. Cleared so a re-seed puts these threads back exactly as documented.
delete from public.ticket_messages
where ticket_id in (${seededTicketIds})
  and id not in (${seededMessageIds});

-- --------------------------------------------------------------------------
-- Read state
--
-- Which is what decides where an unread badge appears. Everyone who can see a
-- ticket is marked caught up except where a badge is wanted — without this,
-- every ticket would badge for everybody (no row means never opened) and
-- nothing resolved would collapse into the archive, since an unread reply keeps
-- a ticket out of it.
-- --------------------------------------------------------------------------

${readStatements.join('\n\n')}

${unreadResets.join('\n\n')}

-- Drop any sessions these accounts already held, so a re-seed forces a fresh
-- sign-in rather than leaving a stale token pointing at the old row.
delete from public.sessions
where user_id in (select id from public.users where email in (${emailList}));
`;

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'seed.sql'
);

await writeFile(outPath, sql, 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
for (const a of accounts) {
  const under = a.parentEmail ? ` under ${a.parentEmail}` : '';
  console.log(`  ${a.role.padEnd(6)} ${a.email.padEnd(20)} ${a.password.padEnd(18)}${under}`);
}

const messageCount = TICKETS.reduce((total, ticket) => total + ticket.messages.length, 0);
console.log(`  ${TICKETS.length} tickets, ${messageCount} messages`);

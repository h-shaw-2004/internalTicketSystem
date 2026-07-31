import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import * as authApi from '../api/auth';
import * as ticketsApi from '../api/tickets';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  createAccount: vi.fn(),
  listChildAccounts: vi.fn(),
  setInitialPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

vi.mock('../api/tickets', () => ({
  listMyTickets: vi.fn(),
  listAgencyTickets: vi.fn(),
  listEscalatedTickets: vi.fn(),
  listTicketsForAgency: vi.fn(),
  getTicket: vi.fn(),
  createTicket: vi.fn(),
  updateTicketStatus: vi.fn(),
  escalateTicket: vi.fn(),
  listTicketMessages: vi.fn(),
  postTicketMessage: vi.fn(),
  markTicketRead: vi.fn(),
  reopenTicket: vi.fn(),
  TicketError: class TicketError extends Error {},
}));

const user = (role, overrides = {}) => ({
  id: `${role}-1`,
  email: `${role}@email.com`,
  fullName: `${role} user`,
  role,
  parentId: role === 'admin' ? null : 'parent-1',
  mustChangePassword: false,
  createdAt: '2026-07-28T09:00:00.000Z',
  ...overrides,
});

const ticket = (overrides = {}) => ({
  id: 't1',
  subject: 'Laptop will not boot',
  description: 'Nothing on screen after the login chime.',
  department: 'hardware',
  urgency: 'high',
  status: 'open',
  clientId: 'client-1',
  agencyId: 'agency-1',
  escalatedAt: null,
  escalatedTo: null,
  createdAt: '2026-07-28T09:00:00.000Z',
  updatedAt: '2026-07-28T09:00:00.000Z',
  client: { id: 'client-1', fullName: 'Client Test User', email: 'client@email.com' },
  ...overrides,
});

function signedInAs(role, path = '/tickets') {
  authApi.getCurrentUser.mockResolvedValue(user(role));
  window.history.pushState({}, '', path);
}

beforeEach(() => {
  vi.clearAllMocks();
  authApi.listChildAccounts.mockResolvedValue([]);
  ticketsApi.listMyTickets.mockResolvedValue([]);
  ticketsApi.listAgencyTickets.mockResolvedValue([]);
  ticketsApi.listEscalatedTickets.mockResolvedValue([]);
  ticketsApi.listTicketsForAgency.mockResolvedValue([]);
  // Some of these navigate through to a ticket, which loads its conversation.
  ticketsApi.listTicketMessages.mockResolvedValue([]);
});

describe('client ticket list', () => {
  it('offers a way in when there is nothing yet', async () => {
    signedInAs('client');

    render(<App />);

    // The empty state has to carry its own way in, because the button in the
    // panel head is hidden on a phone.
    const empty = await screen.findByText(/haven't raised any tickets yet/i);
    expect(within(empty).getByRole('link', { name: /raise a ticket/i })).toHaveAttribute(
      'href',
      '/tickets/new'
    );
  });

  it('lists the tickets they raised', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket()]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: /laptop will not boot/i })).toBeInTheDocument();
    expect(within(table).getByText('Hardware')).toBeInTheDocument();
    // The status chip is in the row twice: its own column for desktop, and
    // under the subject for phones. Only one is ever visible.
    expect(within(table).getAllByText('Open')).toHaveLength(2);
  });

  it('opens a ticket from anywhere on its row, not just the title', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket()]);
    ticketsApi.getTicket.mockResolvedValue(ticket());

    render(<App />);
    const table = await screen.findByRole('table');

    // Click a cell nowhere near the link — the whole bar is the target.
    fireEvent.click(within(table).getByText('Hardware'));

    expect(await screen.findByRole('heading', { level: 1, name: /^ticket$/i })).toBeInTheDocument();
    expect(ticketsApi.getTicket).toHaveBeenCalledWith('t1');
  });

  it('does not double-navigate when the title link itself is clicked', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket()]);
    ticketsApi.getTicket.mockResolvedValue(ticket());

    render(<App />);
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('link', { name: /laptop will not boot/i }));

    await screen.findByRole('heading', { level: 1, name: /^ticket$/i });
    // The row handler must stand aside for real controls.
    expect(ticketsApi.getTicket).toHaveBeenCalledTimes(1);
  });

  /*
   * A phone shows one column. Every other column is dropped and returned inside
   * the subject cell: status and urgency as their own marks, the rest as a
   * muted line. jsdom applies no CSS so both copies are present — which is the
   * point of these assertions. Nothing a narrow screen hides is actually lost.
   */
  it('folds every other column into the subject cell for narrow screens', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([ticket()]);

    render(<App />);

    const table = await screen.findByRole('table');
    const subjectCell = within(table)
      .getByRole('link', { name: /laptop will not boot/i })
      .closest('td');

    // Status and urgency keep their marks rather than becoming sentence text.
    expect(within(subjectCell).getByText('Open')).toHaveClass('status');
    expect(within(subjectCell).getByText('High')).toHaveClass('urgency');
    expect(within(subjectCell).getByText(/Client Test User · Hardware · /)).toBeInTheDocument();

    // The real cells are still there for desktop, and still findable exactly —
    // the muted line is one joined string, so it never collides with them.
    expect(within(table).getByText('Hardware')).toBeInTheDocument();
    expect(within(table).getByText('Client Test User')).toBeInTheDocument();
  });

  it('badges a ticket the agency has replied to', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket({ unreadCount: 3 })]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText(/3 new/)).toBeInTheDocument();
    // The number carries the meaning, so the badge does not rely on its colour.
    expect(within(table).getByText(/unread replies/i)).toBeInTheDocument();
  });

  it('says "reply" rather than "replies" for a single one', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket({ unreadCount: 1 })]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText(/1 new/)).toBeInTheDocument();
    expect(within(table).getByText(/unread reply$/i)).toBeInTheDocument();
  });

  it('shows no badge on a ticket with nothing new', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket({ unreadCount: 0 })]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).queryByText(/new/)).not.toBeInTheDocument();
  });

  it('drops a resolved ticket into the collapsed archive', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({ id: 't1', subject: 'Still broken', status: 'open' }),
      ticket({ id: 't2', subject: 'Sorted last week', status: 'resolved', unreadCount: 0 }),
    ]);

    render(<App />);

    const archive = (await screen.findByText(/resolved \(1\)/i)).closest('details');
    expect(within(archive).getByRole('link', { name: /sorted last week/i })).toBeInTheDocument();
    // Closed by default — out of the way, but one click from reachable.
    expect(archive).not.toHaveAttribute('open');

    // The main table above it keeps only what is outstanding.
    const active = screen.getAllByRole('table')[0];
    expect(within(active).getByRole('link', { name: /still broken/i })).toBeInTheDocument();
    expect(within(active).queryByRole('link', { name: /sorted last week/i })).not.toBeInTheDocument();
  });

  // Below 900px the archive above is hidden and the segmented filter switches
  // here instead — same tickets, no long scroll past the active list.
  it('shows them on their own view for the filter', async () => {
    signedInAs('client', '/tickets?view=resolved');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({ id: 't1', subject: 'Still broken', status: 'open' }),
      ticket({ id: 't2', subject: 'Sorted last week', status: 'resolved', unreadCount: 0 }),
    ]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: /sorted last week/i })).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: /still broken/i })).not.toBeInTheDocument();
  });

  /*
   * The small-screen counterpart to the archive. jsdom applies no CSS so it is
   * always in the DOM here; what these cover is that it filters, counts and
   * marks the current segment correctly.
   */
  describe('the Open / Resolved filter', () => {
    const mixed = [
      ticket({ id: 't1', subject: 'Still broken', status: 'open' }),
      ticket({ id: 't2', subject: 'Also broken', status: 'in_progress' }),
      ticket({ id: 't3', subject: 'Sorted last week', status: 'resolved', unreadCount: 0 }),
    ];

    const filter = () => within(screen.getByRole('group', { name: /show/i }));

    it('counts each side, so neither has to be visited to be known about', async () => {
      signedInAs('client');
      ticketsApi.listMyTickets.mockResolvedValue(mixed);

      render(<App />);
      await screen.findByRole('group', { name: /show/i });

      expect(filter().getByRole('link', { name: /open/i })).toHaveTextContent('2');
      expect(filter().getByRole('link', { name: /resolved/i })).toHaveTextContent('1');
    });

    it('marks Open as current on the default list', async () => {
      signedInAs('client');
      ticketsApi.listMyTickets.mockResolvedValue(mixed);

      render(<App />);
      await screen.findByRole('group', { name: /show/i });

      expect(filter().getByRole('link', { name: /open/i })).toHaveAttribute(
        'aria-current',
        'page'
      );
      expect(filter().getByRole('link', { name: /resolved/i })).not.toHaveAttribute(
        'aria-current'
      );
    });

    it('switches the list when Resolved is chosen', async () => {
      signedInAs('client');
      ticketsApi.listMyTickets.mockResolvedValue(mixed);

      render(<App />);
      await screen.findByRole('group', { name: /show/i });

      fireEvent.click(filter().getByRole('link', { name: /resolved/i }));

      const table = await screen.findByRole('table');
      expect(within(table).getByRole('link', { name: /sorted last week/i })).toBeInTheDocument();
      expect(within(table).queryByRole('link', { name: /still broken/i })).not.toBeInTheDocument();
      expect(filter().getByRole('link', { name: /resolved/i })).toHaveAttribute(
        'aria-current',
        'page'
      );
    });

    it('is not repeated on the admin browse-by-agency panel', async () => {
      signedInAs('admin');
      authApi.listChildAccounts.mockResolvedValue([
        { id: 'agency-1', fullName: 'Agency One', email: 'one@agency.com', role: 'agency' },
      ]);
      ticketsApi.listEscalatedTickets.mockResolvedValue([ticket()]);
      ticketsApi.listTicketsForAgency.mockResolvedValue([ticket({ id: 't9' })]);

      render(<App />);
      fireEvent.change(await screen.findByLabelText(/agency/i), {
        target: { value: 'agency-1' },
      });
      await screen.findAllByRole('table');

      // It belongs to the work queue, not to an ad-hoc oversight query — two
      // identical controls driving one URL would be nonsense.
      expect(screen.getAllByRole('group', { name: /show/i })).toHaveLength(1);
    });
  });

  it('keeps a resolved ticket active while a reply on it is unread', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({ subject: 'Sorted last week', status: 'resolved', unreadCount: 1 }),
    ]);

    render(<App />);

    // Otherwise resolving something buries the conversation on it.
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: /sorted last week/i })).toBeInTheDocument();
    expect(screen.queryByText(/^resolved \(/i)).not.toBeInTheDocument();
  });

  it('says so when everything has been resolved', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket({ status: 'resolved', unreadCount: 0 })]);

    render(<App />);

    expect(await screen.findByText(/nothing outstanding/i)).toBeInTheDocument();
    expect(screen.getByText(/resolved \(1\)/i)).toBeInTheDocument();
  });

  it('says so when the Resolved view is empty', async () => {
    signedInAs('client', '/tickets?view=resolved');
    ticketsApi.listMyTickets.mockResolvedValue([ticket({ status: 'open' })]);

    render(<App />);

    // A different sentence from "nothing outstanding" — opposite situation.
    expect(await screen.findByText(/nothing has been resolved here yet/i)).toBeInTheDocument();
  });

  it('stops counting an escalation once the ticket is resolved', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({
        id: 't1',
        status: 'resolved',
        unreadCount: 0,
        escalatedAt: '2026-07-28T11:00:00.000Z',
        escalatedTo: 'admin-1',
      }),
    ]);

    render(<App />);

    const summary = await screen.findByLabelText('Ticket counts');
    const tile = (label) => within(summary).getByText(label).closest('.summary-tile');

    // escalated_at is never cleared, so the raw field would keep this at 1 and
    // claim an admin still owes something on finished work.
    expect(tile('Escalated')).toHaveTextContent('0');
    expect(tile('Resolved')).toHaveTextContent('1');
  });

  it('counts the escalation again once the client reopens it', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({
        status: 'open',
        escalatedAt: '2026-07-28T11:00:00.000Z',
        escalatedTo: 'admin-1',
      }),
    ]);

    render(<App />);

    const summary = await screen.findByLabelText('Ticket counts');
    expect(within(summary).getByText('Escalated').closest('.summary-tile')).toHaveTextContent('1');
  });

  it('still counts resolved tickets in the summary', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([
      ticket({ id: 't1', status: 'open' }),
      ticket({ id: 't2', status: 'resolved', unreadCount: 0 }),
    ]);

    render(<App />);

    // The split is a view, so the counts stay honest about the whole list.
    const summary = await screen.findByLabelText('Ticket counts');
    const tile = (label) => within(summary).getByText(label).closest('.summary-tile');
    expect(tile('Resolved')).toHaveTextContent('1');
    expect(tile('Open')).toHaveTextContent('1');
  });

  it('shows an error with a working retry rather than an empty page', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockRejectedValueOnce(new Error('Could not load your tickets.'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your tickets/i);

    ticketsApi.listMyTickets.mockResolvedValue([ticket()]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(ticketsApi.listMyTickets).toHaveBeenCalledTimes(2);
  });
});

describe('agency ticket list', () => {
  it('names the client on every row', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([ticket()]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Client Test User')).toBeInTheDocument();
    // Agencies don't raise tickets, so no create affordance.
    expect(
      within(screen.getByRole('main')).queryByRole('link', { name: /raise a ticket/i })
    ).not.toBeInTheDocument();
  });

  it('summarises the list by status above the table', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([
      ticket({ id: 't1', status: 'open' }),
      ticket({ id: 't2', status: 'open' }),
      ticket({
        id: 't3',
        status: 'in_progress',
        escalatedAt: '2026-07-28T11:00:00.000Z',
        escalatedTo: 'admin-1',
      }),
      ticket({ id: 't4', status: 'resolved' }),
    ]);

    render(<App />);

    // Scoped — the same status words appear as badges in the table below.
    const summary = await screen.findByLabelText('Ticket counts');
    const tile = (label) => within(summary).getByText(label).closest('.summary-tile');

    expect(tile('Open')).toHaveTextContent('2');
    expect(tile('In Progress')).toHaveTextContent('1');
    expect(tile('Resolved')).toHaveTextContent('1');
    // Zero is shown rather than hidden, so the row doesn't reflow as work moves.
    expect(tile('On Hold')).toHaveTextContent('0');
    expect(tile('Escalated')).toHaveTextContent('1');
  });

  it('flags escalated tickets in the list', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([
      ticket({ escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'admin-1' }),
    ]);

    render(<App />);

    const table = await screen.findByRole('table');
    const badge = within(table).getByText(/escalated/i);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-escalated');
    expect(badge).toHaveAttribute('title', 'Escalated to admin');
  });

  it('flags a reopened ticket so it does not read as a brand new one', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([
      ticket({ status: 'open', reopenedAt: '2026-07-29T09:00:00.000Z' }),
    ]);

    render(<App />);

    const table = await screen.findByRole('table');
    const badge = within(table).getByText(/^reopened$/i);
    expect(badge).toHaveClass('badge-reopened');
    expect(badge).toHaveAttribute('title', 'The client reopened this after it was resolved');
  });

  it('drops the reopened flag once it is resolved again', async () => {
    signedInAs('agency', '/tickets?view=resolved');
    ticketsApi.listAgencyTickets.mockResolvedValue([
      ticket({ status: 'resolved', unreadCount: 0, reopenedAt: '2026-07-29T09:00:00.000Z' }),
    ]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).queryByText(/^reopened$/i)).not.toBeInTheDocument();
  });

  it('leaves a ticket nobody reopened unflagged', async () => {
    signedInAs('agency');
    ticketsApi.listAgencyTickets.mockResolvedValue([ticket({ status: 'open' })]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).queryByText(/^reopened$/i)).not.toBeInTheDocument();
  });

  it('tones the escalation flag down once the ticket is resolved', async () => {
    signedInAs('agency', '/tickets?view=resolved');
    ticketsApi.listAgencyTickets.mockResolvedValue([
      ticket({
        status: 'resolved',
        unreadCount: 0,
        escalatedAt: '2026-07-28T11:00:00.000Z',
        escalatedTo: 'admin-1',
      }),
    ]);

    render(<App />);

    // On the Resolved view, where it is a record of what happened rather than a
    // flag asking somebody to act.
    const table = await screen.findByRole('table');
    const badge = within(table).getByText(/^escalated$/i);
    expect(badge).toHaveClass('badge-escalated-past');
    expect(badge).not.toHaveClass('badge-escalated');
    expect(badge).toHaveAttribute('title', 'Was escalated to admin before it was resolved');
  });
});

describe('admin ticket list', () => {
  it('shows the escalation queue and a per-agency browser', async () => {
    signedInAs('admin');
    ticketsApi.listEscalatedTickets.mockResolvedValue([
      ticket({ escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'admin-1' }),
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: /escalated to you/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /browse by agency/i })).toBeInTheDocument();
  });

  it('loads an agency queue only once an agency is chosen', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      { id: 'agency-1', fullName: 'Agency One', email: 'one@agency.com', role: 'agency' },
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /browse by agency/i });
    const picker = await screen.findByLabelText(/agency/i);

    // Nothing fetched before a choice is made.
    expect(ticketsApi.listTicketsForAgency).not.toHaveBeenCalled();

    ticketsApi.listTicketsForAgency.mockResolvedValue([ticket()]);
    fireEvent.change(picker, { target: { value: 'agency-1' } });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(ticketsApi.listTicketsForAgency).toHaveBeenCalledWith('agency-1');
  });

  it('lists only agencies in the picker, never the clients beneath them', async () => {
    signedInAs('admin');
    // GET /accounts gives an admin both levels; only agencies are pickable.
    authApi.listChildAccounts.mockResolvedValue([
      { id: 'agency-1', fullName: 'Agency One', email: 'one@agency.com', role: 'agency' },
      { id: 'client-9', fullName: 'Client Nine', email: 'nine@client.com', role: 'client' },
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /browse by agency/i });

    const picker = await screen.findByLabelText(/agency/i);
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toHaveLength(2); // placeholder + the one agency
    expect(options.join(' ')).toMatch(/Agency One/);
    expect(options.join(' ')).not.toMatch(/Client Nine/);
  });

  it('says there are no agencies when the admin only has clients', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      { id: 'client-9', fullName: 'Client Nine', email: 'nine@client.com', role: 'client' },
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /browse by agency/i });

    // Empty must mean "no agencies", not "no accounts at all".
    expect(await screen.findByText(/no agency accounts yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/agency/i)).not.toBeInTheDocument();
  });

  it('keeps the chosen agency selected after viewing one of its tickets', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      { id: 'agency-1', fullName: 'Agency One', email: 'one@agency.com', role: 'agency' },
    ]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([ticket()]);
    ticketsApi.getTicket.mockResolvedValue(ticket());

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/agency/i), {
      target: { value: 'agency-1' },
    });

    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('link', { name: /laptop will not boot/i }));

    // The mobile chevron carries the same destination as the desktop button.
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/tickets?agency=agency-1'
    );

    // …and back again through the page's own control.
    fireEvent.click(screen.getByRole('link', { name: /back to tickets/i }));

    // The picker still holds the agency, and its queue is on screen — no
    // re-picking after every ticket.
    expect(await screen.findByLabelText(/agency/i)).toHaveValue('agency-1');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('preselects an agency named in the URL', async () => {
    signedInAs('admin', '/tickets?agency=agency-1');
    authApi.listChildAccounts.mockResolvedValue([
      { id: 'agency-1', fullName: 'Agency One', email: 'one@agency.com', role: 'agency' },
    ]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([ticket()]);

    render(<App />);

    // A filtered view is linkable, which is the other half of putting it in the URL.
    expect(await screen.findByLabelText(/agency/i)).toHaveValue('agency-1');
    expect(ticketsApi.listTicketsForAgency).toHaveBeenCalledWith('agency-1');
  });

  it('explains an empty escalation queue', async () => {
    signedInAs('admin');

    render(<App />);

    expect(await screen.findByText(/nothing has been escalated to you/i)).toBeInTheDocument();
  });
});

describe('raising a ticket', () => {
  it('sends a client to the new ticket it just raised', async () => {
    signedInAs('client', '/tickets/new');
    ticketsApi.createTicket.mockResolvedValue(ticket({ id: 't9' }));
    ticketsApi.getTicket.mockResolvedValue(ticket({ id: 't9' }));

    render(<App />);
    await screen.findByRole('heading', { name: /raise a ticket/i });

    fireEvent.change(screen.getByLabelText(/subject/i), {
      target: { value: 'Laptop will not boot' },
    });
    fireEvent.change(screen.getByLabelText(/department/i), { target: { value: 'hardware' } });
    fireEvent.change(screen.getByLabelText(/urgency/i), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Nothing on screen after the login chime.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /raise ticket/i }));

    expect(await screen.findByRole('heading', { name: /^ticket$/i })).toBeInTheDocument();
    expect(ticketsApi.createTicket).toHaveBeenCalledWith({
      subject: 'Laptop will not boot',
      department: 'hardware',
      urgency: 'high',
      description: 'Nothing on screen after the login chime.',
    });
  });

  it('keeps non-clients off the raise form', async () => {
    signedInAs('agency', '/tickets/new');

    render(<App />);

    // Redirected to the list rather than shown a form they cannot submit.
    expect(await screen.findByRole('heading', { name: /client tickets/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /raise ticket/i })).not.toBeInTheDocument();
  });
});

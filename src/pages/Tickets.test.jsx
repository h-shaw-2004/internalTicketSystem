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
});

describe('client ticket list', () => {
  it('offers a way in when there is nothing yet', async () => {
    signedInAs('client');

    render(<App />);

    // Empty state explains itself and points at the action.
    expect(await screen.findByText(/haven't raised any tickets yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /raise a ticket/i })).toBeInTheDocument();
  });

  it('lists the tickets they raised', async () => {
    signedInAs('client');
    ticketsApi.listMyTickets.mockResolvedValue([ticket()]);

    render(<App />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: /laptop will not boot/i })).toBeInTheDocument();
    expect(within(table).getByText('Hardware')).toBeInTheDocument();
    expect(within(table).getByText('Open')).toBeInTheDocument();
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
    expect(screen.queryByRole('link', { name: /raise a ticket/i })).not.toBeInTheDocument();
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
    expect(within(table).getByText(/escalated/i)).toBeInTheDocument();
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

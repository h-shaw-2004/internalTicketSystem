import { fireEvent, render, screen } from '@testing-library/react';
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

const user = (role) => ({
  id: `${role}-1`,
  email: `${role}@email.com`,
  fullName: `${role} user`,
  role,
  parentId: role === 'admin' ? null : 'parent-1',
  mustChangePassword: false,
  createdAt: '2026-07-28T09:00:00.000Z',
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

function open(role, overrides = {}) {
  authApi.getCurrentUser.mockResolvedValue(user(role));
  ticketsApi.getTicket.mockResolvedValue(ticket(overrides));
  window.history.pushState({}, '', '/tickets/t1');
}

beforeEach(() => {
  vi.clearAllMocks();
  ticketsApi.listAgencyTickets.mockResolvedValue([]);
  ticketsApi.listMyTickets.mockResolvedValue([]);
});

describe('ticket detail', () => {
  it('shows the full ticket to the client who raised it', async () => {
    open('client');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /laptop will not boot/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing on screen after the login chime/i)).toBeInTheDocument();
    expect(screen.getByText('Hardware')).toBeInTheDocument();
  });

  it('gives a client no way to change the status', async () => {
    open('client');

    render(<App />);
    await screen.findByRole('heading', { name: /laptop will not boot/i });

    expect(screen.queryByRole('heading', { name: /actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /escalate/i })).not.toBeInTheDocument();
  });

  it('lets an agency move the status', async () => {
    open('agency');
    ticketsApi.updateTicketStatus.mockResolvedValue(ticket({ status: 'in_progress' }));

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    // Nothing to save until something actually changes.
    expect(screen.getByRole('button', { name: /update status/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'in_progress' } });
    fireEvent.click(screen.getByRole('button', { name: /update status/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/in progress/i);
    expect(ticketsApi.updateTicketStatus).toHaveBeenCalledWith('t1', 'in_progress');
  });

  it('lets an agency escalate an unescalated ticket', async () => {
    open('agency');
    ticketsApi.escalateTicket.mockResolvedValue(
      ticket({ escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'parent-1' })
    );

    render(<App />);
    const button = await screen.findByRole('button', { name: /escalate to admin/i });
    fireEvent.click(button);

    expect(await screen.findByRole('status')).toHaveTextContent(/escalated to your admin/i);
    expect(ticketsApi.escalateTicket).toHaveBeenCalledWith('t1');
    // Reflects the new state without a reload, and cannot be escalated twice.
    expect(screen.queryByRole('button', { name: /escalate to admin/i })).not.toBeInTheDocument();
  });

  it('does not offer escalation on an already escalated ticket', async () => {
    open('agency', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'parent-1' });

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    expect(screen.queryByRole('button', { name: /escalate to admin/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update status/i })).toBeInTheDocument();
  });

  it('lets an admin change status but not escalate further', async () => {
    open('admin', { escalatedAt: '2026-07-28T11:00:00.000Z', escalatedTo: 'admin-1' });

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    expect(screen.getByRole('button', { name: /update status/i })).toBeInTheDocument();
    // Top of the hierarchy — nobody above to escalate to.
    expect(screen.queryByRole('button', { name: /escalate/i })).not.toBeInTheDocument();
  });

  it('surfaces a refused ticket as an error with a retry', async () => {
    authApi.getCurrentUser.mockResolvedValue(user('agency'));
    ticketsApi.getTicket.mockRejectedValue(new Error('That ticket could not be found.'));
    window.history.pushState({}, '', '/tickets/nope');

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('reports a failed status change without losing the page', async () => {
    open('agency');
    ticketsApi.updateTicketStatus.mockRejectedValue(new Error('Could not update the ticket.'));

    render(<App />);
    await screen.findByRole('heading', { name: /actions/i });

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: /update status/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not update the ticket/i);
    expect(screen.getByRole('heading', { name: /laptop will not boot/i })).toBeInTheDocument();
  });
});

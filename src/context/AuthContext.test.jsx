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

describe('session bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketsApi.listMyTickets.mockResolvedValue([]);
    ticketsApi.listAgencyTickets.mockResolvedValue([]);
    ticketsApi.listEscalatedTickets.mockResolvedValue([]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([]);
    authApi.listChildAccounts.mockResolvedValue([]);
    window.history.pushState({}, '', '/tickets');
  });

  it('shows the login form when there is genuinely no session', async () => {
    authApi.getCurrentUser.mockResolvedValue(null);

    render(<App />);

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('does not mistake a failed lookup for being signed out', async () => {
    authApi.getCurrentUser.mockRejectedValue(new Error('network down'));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /can't reach the server/i })).toBeInTheDocument();
    // The distinction that matters: a blip must not silently log anyone out.
    expect(screen.getByRole('alert')).toHaveTextContent(/have not been signed out/i);
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('retries the lookup without a page reload', async () => {
    authApi.getCurrentUser.mockRejectedValueOnce(new Error('network down'));

    render(<App />);
    await screen.findByRole('heading', { name: /can't reach the server/i });

    authApi.getCurrentUser.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@email.com',
      fullName: 'Admin Test User',
      role: 'admin',
      parentId: null,
      mustChangePassword: false,
      createdAt: '2026-07-28T09:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i })
    ).toBeInTheDocument();
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});

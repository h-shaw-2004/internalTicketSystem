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

const user = (overrides = {}) => ({
  id: 'client-1',
  email: 'new@client.com',
  fullName: 'New Client',
  role: 'client',
  parentId: 'agency-1',
  mustChangePassword: true,
  createdAt: '2026-07-28T09:00:00.000Z',
  ...overrides,
});

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('forced first-time password change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketsApi.listMyTickets.mockResolvedValue([]);
    ticketsApi.listAgencyTickets.mockResolvedValue([]);
    ticketsApi.listEscalatedTickets.mockResolvedValue([]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([]);
    authApi.listChildAccounts.mockResolvedValue([]);
  });

  it('diverts an account that still has its temporary password', async () => {
    authApi.getCurrentUser.mockResolvedValue(user());
    // Heading for anywhere else in the app — the guard should win.
    window.history.pushState({}, '', '/tickets');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /choose a password/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /^tickets$/i })).not.toBeInTheDocument();
  });

  it('sends a settled account away from the page', async () => {
    authApi.getCurrentUser.mockResolvedValue(user({ mustChangePassword: false }));
    window.history.pushState({}, '', '/set-password');

    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i })
    ).toBeInTheDocument();
  });

  it('tracks the rules live as the password is typed', async () => {
    authApi.getCurrentUser.mockResolvedValue(user());
    window.history.pushState({}, '', '/set-password');

    render(<App />);
    await screen.findByRole('heading', { name: /choose a password/i });

    // The checklist sits below both fields. Scoped to inputs — the list's own
    // aria-label matches /new password/i too.
    const fields = screen.getAllByLabelText(/new password/i, { selector: 'input' });
    expect(fields).toHaveLength(2);
    expect(
      fields[1].compareDocumentPosition(
        screen.getByRole('list', { name: /new password requirements/i })
      )
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // It tracks the first box only, so it has to say which one it means.
    expect(screen.getByText(/new password must have/i)).toBeInTheDocument();

    const requirement = (text) => screen.getByText(text).closest('li');

    type('New password', 'abcdefghij');
    expect(requirement(/10 characters or more/i)).toHaveClass('met');
    expect(requirement(/one uppercase letter/i)).not.toHaveClass('met');

    type('New password', 'Abcdefgh1!');
    for (const rule of [
      /10 characters or more/i,
      /one uppercase letter/i,
      /one number/i,
      /one special character/i,
    ]) {
      expect(requirement(rule)).toHaveClass('met');
    }
  });

  it('refuses a password that fails the policy', async () => {
    authApi.getCurrentUser.mockResolvedValue(user());
    window.history.pushState({}, '', '/set-password');

    render(<App />);
    await screen.findByRole('heading', { name: /choose a password/i });

    // Nine characters — one short, everything else satisfied.
    type('New password', 'Abc3!fghi');
    type('Confirm new password', 'Abc3!fghi');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not meet the requirements/i);
    expect(authApi.setInitialPassword).not.toHaveBeenCalled();
  });

  it('refuses a mismatched confirmation', async () => {
    authApi.getCurrentUser.mockResolvedValue(user());
    window.history.pushState({}, '', '/set-password');

    render(<App />);
    await screen.findByRole('heading', { name: /choose a password/i });

    type('New password', 'Abcdefgh1!');
    type('Confirm new password', 'Abcdefgh2!');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(authApi.setInitialPassword).not.toHaveBeenCalled();
  });

  it('saves a compliant password and releases the account', async () => {
    authApi.getCurrentUser.mockResolvedValueOnce(user());
    authApi.setInitialPassword.mockResolvedValue(user({ mustChangePassword: false }));
    // The refresh after saving sees the cleared flag.
    authApi.getCurrentUser.mockResolvedValue(user({ mustChangePassword: false }));
    window.history.pushState({}, '', '/set-password');

    render(<App />);
    await screen.findByRole('heading', { name: /choose a password/i });

    type('New password', 'Abcdefgh1!');
    type('Confirm new password', 'Abcdefgh1!');
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    expect(authApi.setInitialPassword).toHaveBeenCalledWith({ newPassword: 'Abcdefgh1!' });
    // Lands on the ticket list rather than bouncing back to the setup page.
    expect(
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i })
    ).toBeInTheDocument();
  });
});

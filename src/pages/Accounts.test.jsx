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
  parentId: null,
  mustChangePassword: false,
  createdAt: '2026-07-28T09:00:00.000Z',
  ...overrides,
});

function signedInAs(role) {
  authApi.getCurrentUser.mockResolvedValue(user(role));
  window.history.pushState({}, '', '/accounts');
}

function fillForm({ fullName, email }) {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: fullName } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
}

const created = user('agency', {
  id: 'new-1',
  email: 'new@agency.com',
  fullName: 'New Agency',
  mustChangePassword: true,
});

describe('account creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketsApi.listMyTickets.mockResolvedValue([]);
    ticketsApi.listAgencyTickets.mockResolvedValue([]);
    ticketsApi.listEscalatedTickets.mockResolvedValue([]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([]);
    authApi.listChildAccounts.mockResolvedValue([]);
    authApi.createAccount.mockResolvedValue({
      account: created,
      temporaryPassword: 'Tmp7#kZq4vRn2Wp',
    });
  });

  it('shows the generated password once, for handing over', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });
    await screen.findByText(/no agencies yet/i);

    fillForm({ fullName: 'New Agency', email: 'new@agency.com' });
    fireEvent.click(screen.getByRole('button', { name: /create agency account/i }));

    const callout = await screen.findByRole('status');
    expect(callout).toHaveTextContent('Tmp7#kZq4vRn2Wp');
    expect(callout).toHaveTextContent(/not shown again/i);

    // Scoped to the table — the callout shows the same address, so an unscoped
    // query matches twice.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('new@agency.com')).toBeInTheDocument();
  });

  it('never asks the creator to choose a password', async () => {
    signedInAs('admin');

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });
    await screen.findByText(/no agencies yet/i);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    fillForm({ fullName: 'New Agency', email: 'new@agency.com' });
    fireEvent.click(screen.getByRole('button', { name: /create agency account/i }));
    await screen.findByRole('status');

    // A role is sent now that an admin has a choice, but never a password — and
    // the server re-checks the role against what this session may create.
    expect(authApi.createAccount).toHaveBeenCalledWith({
      fullName: 'New Agency',
      email: 'new@agency.com',
      role: 'agency',
      agencyId: '',
    });
  });

  it('flags accounts that have not chosen a password yet', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      created,
      user('agency', { id: 'old-1', email: 'settled@agency.com', mustChangePassword: false }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });

    const pending = (await screen.findByText('new@agency.com')).closest('tr');
    const settled = screen.getByText('settled@agency.com').closest('tr');

    expect(pending).toHaveTextContent(/password not set/i);
    expect(settled).toHaveTextContent(/active/i);
  });

  it('offers an agency clients only, with no type to choose', async () => {
    signedInAs('agency');

    render(<App />);
    expect(await screen.findByRole('heading', { name: /new client account/i })).toBeInTheDocument();
    await screen.findByText(/no client accounts yet/i);

    // One option means no picker, and no agency to name — it is the agency.
    expect(screen.queryByLabelText(/account type/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^agency$/i)).not.toBeInTheDocument();
  });

  it('lets an admin create a client assigned to one of its agencies', async () => {
    signedInAs('admin');
    const agency = user('agency', {
      id: 'agency-7',
      email: 'one@agency.com',
      fullName: 'Agency One',
    });
    authApi.listChildAccounts.mockResolvedValue([agency]);
    authApi.createAccount.mockResolvedValue({
      account: user('client', { id: 'new-c', email: 'new@client.com', fullName: 'New Client' }),
      temporaryPassword: 'Tmp7#kZq4vRn2Wp',
    });

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });

    // The agency picker only appears once Client is chosen.
    expect(screen.queryByLabelText(/^agency$/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/account type/i), { target: { value: 'client' } });
    fireEvent.change(await screen.findByLabelText(/^agency$/i), {
      target: { value: 'agency-7' },
    });

    fillForm({ fullName: 'New Client', email: 'new@client.com' });
    fireEvent.click(screen.getByRole('button', { name: /create client account/i }));

    await screen.findByRole('status');
    expect(authApi.createAccount).toHaveBeenCalledWith({
      fullName: 'New Client',
      email: 'new@client.com',
      role: 'client',
      agencyId: 'agency-7',
    });
  });

  it('offers only the admin own agencies as the parent', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      user('agency', { id: 'agency-7', email: 'one@agency.com', fullName: 'Agency One' }),
      // A grandchild: in the list, but never a parent option.
      user('client', { id: 'client-9', email: 'existing@client.com', fullName: 'Existing' }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });
    fireEvent.change(screen.getByLabelText(/account type/i), { target: { value: 'client' } });

    const picker = await screen.findByLabelText(/^agency$/i);
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toHaveLength(2); // the placeholder plus one agency
    expect(options.join(' ')).toMatch(/Agency One/);
    expect(options.join(' ')).not.toMatch(/Existing/);
  });

  it('blocks creating a client when there is no agency to attach it to', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([]);

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });
    fireEvent.change(screen.getByLabelText(/account type/i), { target: { value: 'client' } });

    expect(await screen.findByText(/create an agency first/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create client account/i })).toBeDisabled();
  });

  it('lists an admin the agencies only, with clients one level in', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      user('agency', { id: 'agency-7', email: 'one@agency.com', fullName: 'Agency One' }),
      user('agency', { id: 'agency-8', email: 'two@agency.com', fullName: 'Agency Two' }),
      user('client', {
        id: 'client-9',
        email: 'under@client.com',
        fullName: 'Under One',
        parentId: 'agency-7',
      }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /your agencies/i });

    // Clients are not in the top-level table — that is the whole point.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('one@agency.com')).toBeInTheDocument();
    expect(within(table).queryByText('under@client.com')).not.toBeInTheDocument();

    // The count is visible without drilling in.
    const agencyRow = within(table).getByText('one@agency.com').closest('tr');
    expect(agencyRow).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Agency One' }));

    expect(
      await screen.findByRole('heading', { name: /clients of agency one/i })
    ).toBeInTheDocument();
    expect(screen.getByText('under@client.com')).toBeInTheDocument();
  });

  it('opens an agency from anywhere on its row', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      user('agency', { id: 'agency-7', email: 'one@agency.com', fullName: 'Agency One' }),
      user('client', {
        id: 'client-9',
        email: 'under@client.com',
        fullName: 'Under One',
        parentId: 'agency-7',
      }),
    ]);

    render(<App />);
    const table = await screen.findByRole('table');

    // The email cell, not the name button.
    fireEvent.click(within(table).getByText('one@agency.com'));

    expect(
      await screen.findByRole('heading', { name: /clients of agency one/i })
    ).toBeInTheDocument();
  });

  it('says so when a chosen agency has no clients', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      user('agency', { id: 'agency-8', email: 'two@agency.com', fullName: 'Agency Two' }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /your agencies/i });
    fireEvent.click(screen.getByRole('button', { name: 'Agency Two' }));

    expect(await screen.findByText(/agency two has no clients yet/i)).toBeInTheDocument();
  });

  it('closes the drilled-in agency again', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      user('agency', { id: 'agency-7', email: 'one@agency.com', fullName: 'Agency One' }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /your agencies/i });

    const toggle = screen.getByRole('button', { name: 'Agency One' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    await screen.findByRole('heading', { name: /clients of agency one/i });
    expect(screen.getByRole('button', { name: 'Agency One' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(
      screen.queryByRole('heading', { name: /clients of agency one/i })
    ).not.toBeInTheDocument();
  });

  it('keeps clients out of the accounts page entirely', async () => {
    signedInAs('client');

    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: /^tickets$/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /new .* account/i })).not.toBeInTheDocument();
    expect(authApi.listChildAccounts).not.toHaveBeenCalled();
  });

  it('surfaces a failure without clearing what was typed', async () => {
    signedInAs('admin');
    authApi.createAccount.mockRejectedValue(
      Object.assign(new Error('An account with that email already exists.'), { field: 'email' })
    );

    render(<App />);
    await screen.findByRole('heading', { name: /^new account$/i });
    await screen.findByText(/no agencies yet/i);

    fillForm({ fullName: 'New Agency', email: 'taken@agency.com' });
    fireEvent.click(screen.getByRole('button', { name: /create agency account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue('taken@agency.com');
  });
});

describe('accounts entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketsApi.listMyTickets.mockResolvedValue([]);
    ticketsApi.listAgencyTickets.mockResolvedValue([]);
    ticketsApi.listEscalatedTickets.mockResolvedValue([]);
    ticketsApi.listTicketsForAgency.mockResolvedValue([]);
    authApi.listChildAccounts.mockResolvedValue([]);
  });

  it('shows the manage link only to roles that can create accounts', async () => {
    for (const [role, expected] of [
      ['admin', /manage accounts/i],
      ['agency', /manage accounts/i],
    ]) {
      authApi.getCurrentUser.mockResolvedValue(user(role));
      window.history.pushState({}, '', '/tickets');
      const { unmount } = render(<App />);

      expect(await screen.findByRole('link', { name: expected })).toBeInTheDocument();
      unmount();
    }

    authApi.getCurrentUser.mockResolvedValue(user('client'));
    window.history.pushState({}, '', '/tickets');
    render(<App />);

    await screen.findByRole('heading', { level: 1, name: /^tickets$/i });
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
  });
});

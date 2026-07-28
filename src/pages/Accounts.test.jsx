import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import * as authApi from '../api/auth';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  createAccount: vi.fn(),
  listChildAccounts: vi.fn(),
  setInitialPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
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
    await screen.findByRole('heading', { name: /new agency account/i });
    await screen.findByText(/no agency accounts yet/i);

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
    await screen.findByRole('heading', { name: /new agency account/i });
    await screen.findByText(/no agency accounts yet/i);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    fillForm({ fullName: 'New Agency', email: 'new@agency.com' });
    fireEvent.click(screen.getByRole('button', { name: /create agency account/i }));
    await screen.findByRole('status');

    // Neither a role nor a password — both are decided below this layer.
    expect(authApi.createAccount).toHaveBeenCalledWith({
      fullName: 'New Agency',
      email: 'new@agency.com',
    });
  });

  it('flags accounts that have not chosen a password yet', async () => {
    signedInAs('admin');
    authApi.listChildAccounts.mockResolvedValue([
      created,
      user('agency', { id: 'old-1', email: 'settled@agency.com', mustChangePassword: false }),
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: /new agency account/i });

    const pending = (await screen.findByText('new@agency.com')).closest('tr');
    const settled = screen.getByText('settled@agency.com').closest('tr');

    expect(pending).toHaveTextContent(/password not set/i);
    expect(settled).toHaveTextContent(/active/i);
  });

  it('offers an agency clients, not agencies', async () => {
    signedInAs('agency');

    render(<App />);
    expect(await screen.findByRole('heading', { name: /new client account/i })).toBeInTheDocument();
    await screen.findByText(/no client accounts yet/i);
    expect(screen.queryByRole('heading', { name: /new agency account/i })).not.toBeInTheDocument();
  });

  it('keeps clients out of the accounts page entirely', async () => {
    signedInAs('client');

    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /internal ticket system/i })
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
    await screen.findByRole('heading', { name: /new agency account/i });
    await screen.findByText(/no agency accounts yet/i);

    fillForm({ fullName: 'New Agency', email: 'taken@agency.com' });
    fireEvent.click(screen.getByRole('button', { name: /create agency account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue('taken@agency.com');
  });
});

describe('dashboard entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.listChildAccounts.mockResolvedValue([]);
  });

  it('shows the manage link only to roles that can create accounts', async () => {
    for (const [role, expected] of [
      ['admin', /manage agency accounts/i],
      ['agency', /manage client accounts/i],
    ]) {
      authApi.getCurrentUser.mockResolvedValue(user(role));
      window.history.pushState({}, '', '/dashboard');
      const { unmount } = render(<App />);

      expect(await screen.findByRole('link', { name: expected })).toBeInTheDocument();
      unmount();
    }

    authApi.getCurrentUser.mockResolvedValue(user('client'));
    window.history.pushState({}, '', '/dashboard');
    render(<App />);

    await screen.findByRole('heading', { name: /internal ticket system/i });
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
  });
});

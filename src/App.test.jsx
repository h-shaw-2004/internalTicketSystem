import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as authApi from './api/auth';

// The api layer is stubbed so this stays a test of the tree, not of the network.
vi.mock('./api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  createAccount: vi.fn(),
  listChildAccounts: vi.fn(),
  setInitialPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

// Smoke test: a blank page in the browser almost always means the tree threw
// during render, which this catches without needing a browser open.
describe('<App />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.getCurrentUser.mockResolvedValue(null);
    window.history.pushState({}, '', '/');
  });

  it('sends an unauthenticated visitor to the login form', async () => {
    render(<App />);

    // Resolves only once AuthProvider has settled and the guards have run.
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Exact, not /password/i — the show/hide toggle's aria-label matches that
    // too, and the query would find two elements.
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('offers no way to sign up — accounts are created top-down', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /sign in/i });

    expect(screen.queryByRole('link', { name: /create/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign up|register/i })).not.toBeInTheDocument();
  });
});

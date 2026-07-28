import { fireEvent, render, screen } from '@testing-library/react';
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

describe('password visibility toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.getCurrentUser.mockResolvedValue(null);
    window.history.pushState({}, '', '/login');
  });

  it('reveals and re-hides the password', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /sign in/i });

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('keeps what was typed across the toggle', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /sign in/i });

    const input = screen.getByLabelText('Password');
    fireEvent.change(input, { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));

    expect(input).toHaveValue('correct-horse');
  });

  it('reports its state to assistive tech', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /sign in/i });

    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Not a submit button — clicking it must never post the form.
    expect(toggle).toHaveAttribute('type', 'button');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(authApi.login).not.toHaveBeenCalled();
  });
});

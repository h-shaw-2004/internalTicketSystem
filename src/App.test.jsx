import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

// Smoke test: a blank page in the browser almost always means the tree threw
// during render, which this catches without needing a browser open.
describe('<App />', () => {
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

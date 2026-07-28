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
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create one/i })).toBeInTheDocument();
  });
});

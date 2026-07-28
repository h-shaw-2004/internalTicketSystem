import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PasswordField from '../components/PasswordField';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(form);
      // Always the dashboard, never wherever the browser happened to be.
      // Returning to the previous page is only correct when the *same* account
      // signs back in; after a switch it drops the new user onto someone else's
      // page, which may not even be theirs to see.
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError({ message: err.message, field: err.field });
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <header className="auth-header">
          <h1>Sign in</h1>
          <p>Internal Ticket System</p>
        </header>

        {error && (
          <p className="alert" role="alert">
            {error.message}
          </p>
        )}

        <label className="field" htmlFor="email">
          <span>Email</span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            aria-invalid={error?.field === 'email' || undefined}
            required
          />
        </label>

        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={form.password}
          onChange={update('password')}
          invalid={error?.field === 'password'}
        />

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-switch">
          Accounts are created by your agency or administrator.
        </p>
      </form>
    </div>
  );
}

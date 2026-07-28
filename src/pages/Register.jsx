import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();

    if (form.password !== form.confirmPassword) {
      setError({ message: 'Passwords do not match.', field: 'confirmPassword' });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await register(form);
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
          <h1>Create account</h1>
          <p>Internal Ticket System</p>
        </header>

        {error && (
          <p className="alert" role="alert">
            {error.message}
          </p>
        )}

        <label className="field" htmlFor="fullName">
          <span>Full name</span>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            value={form.fullName}
            onChange={update('fullName')}
            aria-invalid={error?.field === 'fullName' || undefined}
            required
          />
        </label>

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

        <label className="field" htmlFor="password">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            aria-invalid={error?.field === 'password' || undefined}
            required
          />
          <small className="hint">At least 8 characters.</small>
        </label>

        <label className="field" htmlFor="confirmPassword">
          <span>Confirm password</span>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            aria-invalid={error?.field === 'confirmPassword' || undefined}
            required
          />
        </label>

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

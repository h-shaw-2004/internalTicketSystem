import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setInitialPassword } from '../api/auth';
import { checkPassword } from '../lib/passwordPolicy';
import PasswordField from '../components/PasswordField';

/**
 * First sign-in step for an account created with a generated password. The
 * route guard makes this unskippable — every other protected route redirects
 * here until must_change_password clears.
 */
export default function SetPassword() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Recomputed every keystroke so the checklist tracks what is typed. Same
  // function src/api/auth.js validates with, so the two cannot disagree.
  const { valid, results } = checkPassword(form.newPassword);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();

    if (!valid) {
      setError({ message: 'Password does not meet the requirements.', field: 'newPassword' });
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError({ message: 'Passwords do not match.', field: 'confirmPassword' });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await setInitialPassword({ newPassword: form.newPassword });
      // Reload the session so the guards see must_change_password cleared,
      // otherwise the redirect below bounces straight back here.
      await refresh();
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
          <h1>Choose a password</h1>
          <p>
            Signed in as {user.email}. Replace the temporary password you were given
            before continuing.
          </p>
        </header>

        {error && (
          <p className="alert" role="alert">
            {error.message}
          </p>
        )}

        <PasswordField
          id="newPassword"
          label="New password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={update('newPassword')}
          invalid={error?.field === 'newPassword'}
        />

        <PasswordField
          id="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          invalid={error?.field === 'confirmPassword'}
        />

        {/* Sits below both boxes but tracks the first one only, so it says so —
            otherwise it reads as describing whichever field has focus. */}
        <div className="policy">
          <p className="policy-heading">New password must have:</p>
          <ul className="policy-list" aria-label="New password requirements">
            {results.map((rule) => (
              <li key={rule.id} className={rule.met ? 'met' : undefined}>
                <span className="policy-mark" aria-hidden="true">
                  {rule.met ? '✓' : '○'}
                </span>
                {rule.label}
                <span className="visually-hidden">{rule.met ? ' — met' : ' — not met'}</span>
              </li>
            ))}
          </ul>
        </div>

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save password'}
        </button>

        <p className="auth-switch">
          Not your account?{' '}
          <button className="link-button" type="button" onClick={logout}>
            Sign out
          </button>
        </p>
      </form>
    </div>
  );
}

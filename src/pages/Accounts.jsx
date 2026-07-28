import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createAccount, listChildAccounts } from '../api/auth';
import { ROLE_LABELS, creatableRole } from '../lib/roles';
import AppHeader from '../components/AppHeader';

const EMPTY_FORM = { fullName: '', email: '' };

/**
 * Account management, one level down. The role being created is never a form
 * field — it falls out of who is signed in, so an admin lands on "new agency"
 * and an agency on "new client" without either being able to pick.
 */
export default function Accounts() {
  const { user } = useAuth();
  const targetRole = creatableRole(user.role);

  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  // The generated password, held only until the next creation or a reload.
  // Nothing can retrieve it again, so the creator has to pass it on now.
  const [issued, setIssued] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await listChildAccounts());
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError(null);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssued(null);

    try {
      const { account, temporaryPassword } = await createAccount(form);
      setForm(EMPTY_FORM);
      setIssued({ email: account.email, password: temporaryPassword, role: account.role });
      await refresh();
    } catch (err) {
      setError({ message: err.message, field: err.field });
    } finally {
      setSubmitting(false);
    }
  }

  // The route guard already keeps clients out; this is the belt to its braces.
  if (!targetRole) {
    return (
      <div className="app-layout">
        <main className="app-main">
          <p className="alert" role="alert">
            Your account type cannot create other accounts.
          </p>
        </main>
      </div>
    );
  }

  const label = ROLE_LABELS[targetRole];

  return (
    <div className="app-layout">
      <AppHeader
        title="Accounts"
        action={
          <Link className="button button-ghost" to="/dashboard">
            Back to dashboard
          </Link>
        }
      />

      <main className="app-main app-main-stack">
        <section className="panel">
          <h2>New {label.toLowerCase()} account</h2>
          <p className="muted panel-intro">
            A temporary password is generated for them. They must replace it the first
            time they sign in, so you never learn the password they end up using.
          </p>

          <form className="stack-form" onSubmit={handleSubmit} noValidate>
            {issued && (
              <div className="notice credential-callout" role="status">
                <p className="credential-lead">
                  {ROLE_LABELS[issued.role]} account created. Pass these on now — the
                  password is not shown again.
                </p>
                <dl className="credential-list">
                  <dt>Email</dt>
                  <dd>
                    <code>{issued.email}</code>
                  </dd>
                  <dt>Temporary password</dt>
                  <dd>
                    <code>{issued.password}</code>
                  </dd>
                </dl>
              </div>
            )}

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
                autoComplete="off"
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
                autoComplete="off"
                value={form.email}
                onChange={update('email')}
                aria-invalid={error?.field === 'email' || undefined}
                required
              />
            </label>

            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : `Create ${label.toLowerCase()} account`}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Your {label.toLowerCase()} accounts</h2>

          {loading && <p className="muted">Loading…</p>}

          {loadError && (
            <p className="alert" role="alert">
              {loadError}
            </p>
          )}

          {!loading && !loadError && accounts.length === 0 && (
            <p className="muted">No {label.toLowerCase()} accounts yet.</p>
          )}

          {accounts.length > 0 && (
            <div className="table-scroll">
              <table className="account-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.fullName}</td>
                      <td>{account.email}</td>
                      <td>
                        {account.mustChangePassword ? (
                          <span className="status status-pending">Password not set</span>
                        ) : (
                          <span className="status status-active">Active</span>
                        )}
                      </td>
                      <td>{new Date(account.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

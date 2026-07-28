import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, ROLES, hasRole } from '../lib/roles';

// Placeholder landing page — proves the session and the role hierarchy work.
// Ticket views replace this next.
export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <div>
          <h1>Internal Ticket System</h1>
          <p className="muted">
            {user.fullName} · <span className="badge">{ROLE_LABELS[user.role]}</span>
          </p>
        </div>
        <button className="button button-ghost" type="button" onClick={logout}>
          Sign out
        </button>
      </header>

      <main className="app-main">
        <section className="panel">
          <h2>Your access</h2>
          <ul className="access-list">
            <li>Raise and track your own tickets</li>
            {hasRole(user.role, ROLES.AGENCY) && <li>Pick up and respond to client tickets</li>}
            {hasRole(user.role, ROLES.ADMIN) && <li>Manage accounts and account types</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}

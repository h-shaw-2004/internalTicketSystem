import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, ROLES, canCreateAccounts, creatableRole, hasRole } from '../../shared/roles.js';
import AppHeader from '../components/AppHeader';

// Placeholder landing page — proves the session and the role hierarchy work.
// Ticket views replace this next.
export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="app-layout">
      <AppHeader
        title="Internal Ticket System"
        action={
          <>
            <Link className="button" to="/tickets">
              Tickets
            </Link>
            {canCreateAccounts(user.role) && (
              <Link className="button button-ghost" to="/accounts">
                Manage {ROLE_LABELS[creatableRole(user.role)].toLowerCase()} accounts
              </Link>
            )}
          </>
        }
      />

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

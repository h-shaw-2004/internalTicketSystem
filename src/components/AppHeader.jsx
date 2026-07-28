import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../../shared/roles.js';

/**
 * The signed-in page header: title, who you are, page-specific actions, sign
 * out. Shared so the identity line and sign-out don't drift between pages.
 */
export default function AppHeader({ title, action = null }) {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        <p className="muted">
          {user.fullName} · <span className="badge">{ROLE_LABELS[user.role]}</span>
        </p>
      </div>

      <div className="header-actions">
        {action}
        <button className="button button-ghost" type="button" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}

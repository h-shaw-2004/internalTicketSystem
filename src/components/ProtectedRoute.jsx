import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../../shared/roles.js';

/**
 * Gate a route behind a signed-in session, and optionally a minimum account
 * type. `requiredRole` is inclusive of everything above it, so `agency` also
 * admits admins.
 */
export default function ProtectedRoute({ requiredRole, children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="route-status">Loading…</div>;
  }

  if (!user) {
    // Deliberately carries no "return to" location. Signing in always lands on
    // the dashboard, because the next person through this form is often a
    // different account than the one that was bounced.
    return <Navigate to="/login" replace />;
  }

  // An account still on its generated password gets nothing else until it picks
  // one. /set-password is guarded by PasswordSetupRoute instead, so this cannot
  // bounce against itself.
  if (user.mustChangePassword) {
    return <Navigate to="/set-password" replace />;
  }

  if (requiredRole && !hasRole(user.role, requiredRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

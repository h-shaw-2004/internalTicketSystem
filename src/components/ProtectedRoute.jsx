import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../lib/roles';

/**
 * Gate a route behind a signed-in session, and optionally a minimum account
 * type. `requiredRole` is inclusive of everything above it, so `agency` also
 * admits admins.
 */
export default function ProtectedRoute({ requiredRole, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="route-status">Loading…</div>;
  }

  if (!user) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && !hasRole(user.role, requiredRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Gate for /set-password. The mirror image of ProtectedRoute's check: this is
 * the one route that requires must_change_password to be set, which is what
 * stops the two guards redirecting into each other.
 */
export default function PasswordSetupRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="route-status">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Already chosen a password — nothing to do here.
  if (!user.mustChangePassword) {
    return <Navigate to="/tickets" replace />;
  }

  return children;
}

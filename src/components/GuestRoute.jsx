import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Keeps signed-in users off the login page. */
export default function GuestRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="route-status">Loading…</div>;
  }

  return user ? <Navigate to="/dashboard" replace /> : children;
}

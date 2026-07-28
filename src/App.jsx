import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import GuestRoute from './components/GuestRoute';
import PasswordSetupRoute from './components/PasswordSetupRoute';
import { ROLES } from '../shared/roles.js';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import SetPassword from './pages/SetPassword';
import Tickets from './pages/Tickets';
import NewTicket from './pages/NewTicket';
import TicketDetail from './pages/TicketDetail';

// There is no /register route. Accounts are created top-down from /accounts by
// the account one level above, and admins are seeded via supabase/seed.sql.
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/set-password"
            element={
              <PasswordSetupRoute>
                <SetPassword />
              </PasswordSetupRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/accounts"
            // Agency is the lowest role that can create anything, and the guard
            // is inclusive upward, so this admits agencies and admins.
            element={
              <ProtectedRoute requiredRole={ROLES.AGENCY}>
                <Accounts />
              </ProtectedRoute>
            }
          />
          {/* Every role has a tickets view — which one is decided inside the
              page, since the three differ in content rather than access. */}
          <Route
            path="/tickets"
            element={
              <ProtectedRoute>
                <Tickets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets/new"
            element={
              <ProtectedRoute>
                <NewTicket />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <ProtectedRoute>
                <TicketDetail />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

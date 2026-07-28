import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/auth';
import FullPageError from '../components/FullPageError';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Starts true so guards render a loading state instead of bouncing a signed-in
  // user to /login on the first paint, before the session has been resolved.
  const [loading, setLoading] = useState(true);
  // Distinct from `user === null`. A failed lookup is NOT the same as being
  // signed out: treating them alike dumps a perfectly valid session at /login
  // with no explanation, and makes every network blip look like an auth bug.
  const [bootstrapError, setBootstrapError] = useState(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setBootstrapError(null);

    try {
      const current = await authApi.getCurrentUser();
      if (mounted.current) setUser(current);
    } catch (err) {
      if (mounted.current) {
        setUser(null);
        setBootstrapError(err);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const login = useCallback(async (credentials) => {
    const current = await authApi.login(credentials);
    setUser(current);
    return current;
  }, []);

  // Re-reads the session when something has changed the stored user underneath
  // us — setting an initial password clears must_change_password, and the guards
  // key off that.
  const refresh = useCallback(async () => {
    const current = await authApi.getCurrentUser();
    setUser(current);
    return current;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  // Only session state lives here. Account *creation* does not change who is
  // signed in, so pages call src/api/auth.js directly for that.
  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  // Rendered here rather than in each guard: with no resolved session there is
  // no correct route to show, and all three guards would otherwise duplicate it.
  if (bootstrapError && !loading) {
    return (
      <FullPageError
        title="Can't reach the server"
        message="Your session could not be checked. You have not been signed out — this is usually a connection problem."
        detail={import.meta.env.DEV ? String(bootstrapError?.message ?? bootstrapError) : null}
        onRetry={loadSession}
        retryLabel="Retry"
      />
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}

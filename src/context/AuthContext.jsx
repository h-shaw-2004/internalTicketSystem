import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Starts true so guards render a loading state instead of bouncing a signed-in
  // user to /login on the first paint, before the session has been resolved.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    authApi
      .getCurrentUser()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}

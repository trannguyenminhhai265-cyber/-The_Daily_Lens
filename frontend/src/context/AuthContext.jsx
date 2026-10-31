import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({ site_name: 'The Daily Lens', tagline: '' });
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await api('/auth/me');
      setUser(me);
    } catch {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { settings: s } = await api('/settings/public');
      setSettings(s);
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => {
    Promise.all([loadMe(), loadSettings()]).finally(() => setReady(true));
  }, [loadMe, loadSettings]);

  const login = useCallback(async (loginId, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { login: loginId, password } });
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api('/auth/register', { method: 'POST', body: payload });
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const perms = new Set(user ? user.effective_permissions : []);
    return {
      user,
      setUser,
      ready,
      settings,
      reloadSettings: loadSettings,
      login,
      register,
      logout,
      can: (...p) => p.some((x) => perms.has(x)),
      isStaff: perms.size > 0,
    };
  }, [user, ready, settings, loadSettings, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

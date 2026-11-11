import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { supabase, getSupabase } from "../supabase";

const AuthContext = createContext(null);
const SITE = {
  site_name: "The Daily Lens",
  tagline: "News search project",
  allow_registration: true,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async () => {
    if (!supabase || !(await supabase.auth.getSession()).data.session) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await api("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    loadMe().finally(() => {
      if (mounted) setReady(true);
    });
    const listener = supabase?.auth.onAuthStateChange(() => {
      // Run outside the Auth callback's lock (RPC may need to refresh the session).
      setTimeout(() => {
        if (mounted) loadMe();
      }, 0);
    });
    return () => {
      mounted = false;
      listener?.data.subscription.unsubscribe();
    };
  }, [loadMe]);

  const login = useCallback(async (loginId, password) => {
    const data = await api("/auth/login", {
      method: "POST",
      body: { login: loginId, password },
    });
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api("/auth/register", { method: "POST", body: payload });
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw error;
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const isAdmin = user?.role === "admin";
    return {
      user,
      setUser,
      ready,
      settings: SITE,
      login,
      register,
      logout,
      isAdmin,
    };
  }, [user, ready, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

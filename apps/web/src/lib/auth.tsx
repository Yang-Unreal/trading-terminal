import { createContext, useContext, useEffect, useState } from "react";

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [csrf, setCsrf] = useState<string | null>(null);

  const fetchCsrf = async () => {
    const r = await fetch("http://localhost:3000/auth/csrf", { credentials: "include" });
    const d = await r.json();
    setCsrf(d.csrf_token);
    return d.csrf_token as string;
  };

  const refresh = async () => {
    try {
      const r = await fetch("http://localhost:3000/auth/me", { credentials: "include" });
      setAuthenticated(r.ok);
    } catch {
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCsrf();
    refresh();
  }, []);

  const login = async (username: string, password: string) => {
    const token = await fetchCsrf();
    const r = await fetch("http://localhost:3000/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error("login failed");
    await fetchCsrf();
    setAuthenticated(true);
  };

  const logout = async () => {
    const token = csrf ?? (await fetchCsrf());
    await fetch("http://localhost:3000/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": token },
    });
    setAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ loading, authenticated, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

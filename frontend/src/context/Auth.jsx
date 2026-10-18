import { createContext, useContext, useEffect, useState } from "react";
import { api, apiErr, setAuthToken, onUnauthorized } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader } from "@/components/Loader";
import logo from "@/assets/brand/logo.webp";
import { LogIn, Loader2 } from "lucide-react";

const TOKEN_KEY = "ledger_token";
const USER_KEY = "ledger_user";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function LoginScreen({ onSignedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) return setErr("Enter your username and password");
    setBusy(true);
    setErr("");
    try {
      const res = await api.login(username.trim(), password);
      onSignedIn(res);
    } catch (ex) {
      setErr(apiErr(ex));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4" data-testid="login-screen">
      <Card className="w-full max-w-sm rounded-sm border-2 border-border p-7 shadow-none">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src={logo} alt="Veena Garments Pvt Ltd, since 1965" className="h-36 w-36" data-testid="login-logo" />
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Order Ledger</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-widest">Username</Label>
            <Input
              data-testid="login-username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Password</Label>
            <Input
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 rounded-sm border-2"
            />
          </div>
          {err && (
            <p data-testid="login-error" className="rounded-sm border-2 border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {err}
            </p>
          )}
          <Button data-testid="login-submit" type="submit" disabled={busy} className="w-full gap-2 rounded-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? "Signing in…" : "Sign In"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(() => localStorage.getItem(USER_KEY) || "");
  // { role, salesman_id }. Only decides what the screen offers - the server
  // checks the role on every request, so editing this in the browser gains
  // nothing. Not stored: the /me check below fills it before anything renders.
  const [profile, setProfile] = useState({ id: "", role: "", salesman_id: null });
  const [checking, setChecking] = useState(!!localStorage.getItem(TOKEN_KEY));

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAuthToken("");
    setToken("");
    setUser("");
    setProfile({ id: "", role: "", salesman_id: null });
  };

  const signIn = ({ token: t, id, username, role, salesman_id }) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, username);
    setAuthToken(t);
    setToken(t);
    setUser(username);
    setProfile({ id, role, salesman_id });
  };

  // Keep axios in step with the token, and drop it the moment the server
  // says it is no longer good.
  useEffect(() => {
    setAuthToken(token);
    onUnauthorized(signOut);
  }, [token]);

  // A stored token may have expired while the tab was closed - check once.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    setAuthToken(localStorage.getItem(TOKEN_KEY));
    (async () => {
      try {
        const me = await api.me();
        setUser(me.username);
        setProfile({ id: me.id, role: me.role, salesman_id: me.salesman_id });
        localStorage.setItem(USER_KEY, me.username);
      } catch {
        signOut();
      } finally {
        setChecking(false);
      }
    })();
  }, []); // eslint-disable-line

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center" data-testid="auth-checking">
        <Loader label="Starting…" />
      </div>
    );
  }

  if (!token) return <LoginScreen onSignedIn={signIn} />;

  return (
    <AuthCtx.Provider
      value={{
        user,
        role: profile.role,
        isAdmin: profile.role === "admin",
        isSalesman: profile.role === "salesman",
        // rates, amounts and values - the server strips them for everyone else
        seesMoney: profile.role === "admin" || profile.role === "editor",
        // may change office data - the same two roles, named for what it guards
        canEdit: profile.role === "admin" || profile.role === "editor",
        // the salesman in Masters this login is, for salesman logins
        salesmanId: profile.salesman_id,
        // who is signed in - a salesman may change only what he entered
        userId: profile.id,
        signOut,
        // Everything behind the login is already authenticated, so this just
        // runs the action. Kept so existing call sites need no changes, and so
        // a stricter check could be reintroduced in one place later.
        requireUnlock: (action) => action && action(),
        unlocked: true,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

import { useState } from "react";
import { api } from "../api";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ErrorMessage } from "../components/common";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: "", password: "" });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null });
    try {
      await login(form.login, form.password);
      navigate((location.state && location.state.from) || "/", {
        replace: true,
      });
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const recover = async () => {
    setState({ busy: true, error: null });
    try {
      await api("/auth/recover", {
        method: "POST",
        body: { email: form.login },
      });
      setState({ busy: false, recoverySent: true });
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Sign in</h1>
        <ErrorMessage error={state.error} />
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={state.busy}>
          {state.busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={recover}
          disabled={state.busy || !form.login.includes("@")}
        >
          Forgot password?
        </button>
        {state.recoverySent && (
          <p className="muted">
            If this email has an account, a recovery link will be sent.
          </p>
        )}
        <p className="muted small">
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </form>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    email: "",
    display_name: "",
    password: "",
    confirm: "",
  });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setState({ busy: false, error: new Error("Passwords do not match") });
      return;
    }
    setState({ busy: true, error: null });
    try {
      const { confirm, ...payload } = form; // eslint-disable-line no-unused-vars
      const result = await register(payload);
      if (result.confirmationRequired) {
        setState({ busy: false, error: null, confirmationRequired: true });
        return;
      }
      navigate("/profile");
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  if (state.confirmationRequired)
    return (
      <div className="container auth-wrap">
        <div className="auth-card">
          <h1>Check your email</h1>
          <p>
            Open the confirmation link to activate your account, then sign in.
          </p>
          <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    );

  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Create your account</h1>
        <ErrorMessage error={state.error} />
        <label>
          Username
          <input
            value={form.username}
            onChange={set("username")}
            pattern="[a-zA-Z0-9_]{3,30}"
            title="3-30 letters, numbers or underscores"
            required
          />
        </label>
        <label>
          Display name
          <input
            value={form.display_name}
            onChange={set("display_name")}
            maxLength={60}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={set("email")}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            minLength={8}
            required
          />
          <span className="hint">
            At least 8 characters with a letter and a number.
          </span>
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set("confirm")}
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={state.busy}>
          {state.busy ? "Creating…" : "Create account"}
        </button>
        <p className="muted small">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

export function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState({ busy: false, error: null, ok: false });
  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setState({ error: new Error("Passwords do not match") });
      return;
    }
    setState({ busy: true });
    try {
      await api("/auth/reset-password", { method: "POST", body: { password } });
      setState({ ok: true });
    } catch (error) {
      setState({ error });
    }
  };
  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Reset password</h1>
        <ErrorMessage error={state.error} />
        {state.ok ? (
          <p>
            Password updated. <Link to="/login">Sign in</Link>
          </p>
        ) : (
          <>
            <p className="muted">
              Open the recovery link from your email before setting a new
              password.
            </p>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={state.busy}>
              Save password
            </button>
          </>
        )}
      </form>
    </div>
  );
}

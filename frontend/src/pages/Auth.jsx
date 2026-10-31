import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../components/common';
import { useAuth } from '../context/AuthContext';

const DEMO_ACCOUNTS = [
  ['admin', 'Admin@123', 'Super Admin'],
  ['editor', 'Password123', 'Content Manager'],
  ['moderator', 'Password123', 'Moderator'],
  ['seo', 'Password123', 'Data & SEO'],
  ['alex_reader', 'Password123', 'Reader'],
];

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: '', password: '' });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null });
    try {
      await login(form.login, form.password);
      navigate((location.state && location.state.from) || '/', { replace: true });
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
          Email or username
          <input autoComplete="username" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
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
          {state.busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">
          No account yet? <Link to="/register">Create one</Link>
        </p>
        <div className="demo-accounts">
          <div className="small muted">Demo accounts (click to fill):</div>
          {DEMO_ACCOUNTS.map(([u, p, role]) => (
            <button type="button" key={u} className="chip" onClick={() => setForm({ login: u, password: p })}>
              {role}: <code>{u}</code>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

export function Register() {
  const { register, settings } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', display_name: '', password: '', confirm: '' });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setState({ busy: false, error: new Error('Passwords do not match') });
      return;
    }
    setState({ busy: true, error: null });
    try {
      const { confirm, ...payload } = form; // eslint-disable-line no-unused-vars
      await register(payload);
      navigate('/profile');
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  if (settings.allow_registration === false) {
    return (
      <div className="container auth-wrap">
        <div className="auth-card">
          <h1>Registration closed</h1>
          <p className="muted">New registrations are currently disabled by the site administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Create your account</h1>
        <ErrorMessage error={state.error} />
        <label>
          Username
          <input value={form.username} onChange={set('username')} pattern="[a-zA-Z0-9_]{3,30}" title="3-30 letters, numbers or underscores" required />
        </label>
        <label>
          Display name
          <input value={form.display_name} onChange={set('display_name')} maxLength={60} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} minLength={8} required />
          <span className="hint">At least 8 characters with a letter and a number.</span>
        </label>
        <label>
          Confirm password
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </label>
        <button className="btn btn-primary btn-block" disabled={state.busy}>
          {state.busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted small">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

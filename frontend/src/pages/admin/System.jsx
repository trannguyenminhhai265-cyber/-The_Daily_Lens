// Super Admin screens: users & roles, system logs, search logs, global settings.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ErrorMessage, Modal, Pagination, Spinner, StatusBadge, UserLink } from '../../components/common';
import { useAuth } from '../../context/AuthContext';
import { useApi } from '../../hooks';
import { ROLE_LABELS, formatDate, formatDateTime } from '../../utils';

function UserEditor({ user, meta, onClose, onSaved }) {
  const isNew = !user;
  const [form, setForm] = useState({
    username: user ? user.username : '',
    email: user ? user.email : '',
    display_name: user ? user.display_name : '',
    role: user ? user.role : 'user',
    permissions: user ? user.permissions : [],
    status: user ? user.status : 'active',
    is_muted: user ? user.is_muted : false,
    password: '',
  });
  const [state, setState] = useState({ busy: false, error: null });
  const roleDefaults = new Set((meta.roles.find((r) => r.value === form.role) || { permissions: [] }).permissions);

  const togglePerm = (p) =>
    setForm({ ...form, permissions: form.permissions.includes(p) ? form.permissions.filter((x) => x !== p) : [...form.permissions, p] });

  const save = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null });
    try {
      const body = { ...form, permissions: form.permissions.filter((p) => !roleDefaults.has(p)) };
      if (!body.password) delete body.password;
      if (isNew) await api('/admin/users', { method: 'POST', body });
      else {
        delete body.username;
        await api(`/admin/users/${user.id}`, { method: 'PATCH', body });
      }
      onSaved();
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <Modal title={isNew ? 'Create user' : `Edit @${user.username}`} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <ErrorMessage error={state.error} />
        <div className="two-col">
          <label>
            Username
            <input value={form.username} onChange={set('username')} disabled={!isNew} required />
          </label>
          <label>
            Display name
            <input value={form.display_name} onChange={set('display_name')} />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label>
            {isNew ? 'Password' : 'Reset password'} <span className="hint">{isNew ? '' : '(leave empty to keep)'}</span>
            <input type="password" value={form.password} onChange={set('password')} required={isNew} minLength={8} />
          </label>
          <label>
            Role
            <select value={form.role} onChange={set('role')}>
              {meta.roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label>
            Account status
            <select value={form.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="banned">Suspended</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.is_muted} onChange={set('is_muted')} /> Muted (cannot comment)
        </label>
        <fieldset className="perm-grid">
          <legend>Permissions <span className="hint">(greyed = included in role; tick others to grant extra)</span></legend>
          {meta.permissions.map((p) => (
            <label key={p.value} className={`check ${roleDefaults.has(p.value) ? 'inherited' : ''}`}>
              <input
                type="checkbox"
                checked={roleDefaults.has(p.value) || form.permissions.includes(p.value)}
                disabled={roleDefaults.has(p.value)}
                onChange={() => togglePerm(p.value)}
              />
              <span>
                <code>{p.value}</code> <span className="small muted">{p.label}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={state.busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function Users() {
  const { user: me } = useAuth();
  const [filter, setFilter] = useState({ q: '', role: '', page: 1 });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const [error, setError] = useState(null);
  const meta = useApi('/admin/meta');
  const { data, loading, reload } = useApi('/admin/users', filter);

  const remove = async (u) => {
    if (!window.confirm(`Delete @${u.username}? Their comments, likes and ratings will be removed.`)) return;
    setError(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Users & roles</h1>
        <button className="btn btn-primary" onClick={() => setEditing(null)} disabled={!meta.data}>+ New user</button>
      </div>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, q, page: 1 });
        }}
      >
        <input className="grow" placeholder="Search username, name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value, page: 1 })}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button className="btn btn-ghost">Search</button>
      </form>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>User</th><th>Role</th><th>Extra permissions</th><th>Status</th><th>Last login</th><th /></tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <UserLink user={u} /> <span className="muted small">@{u.username}</span>
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td><span className="badge badge-role">{ROLE_LABELS[u.role]}</span></td>
                      <td>{u.permissions.map((p) => <code key={p} className="perm">{p}</code>)}</td>
                      <td>
                        <StatusBadge status={u.status} />
                        {u.is_muted && <span className="badge badge-hidden">muted</span>}
                      </td>
                      <td className="small">{u.last_login_at ? formatDateTime(u.last_login_at) : '—'}</td>
                      <td className="row-actions">
                        <button onClick={() => setEditing(u)} disabled={!meta.data}>Edit</button>
                        {u.id !== me.id && <button className="danger" onClick={() => remove(u)}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => setFilter({ ...filter, page: p })} />
          </>
        )
      )}
      {editing !== undefined && meta.data && (
        <UserEditor
          user={editing}
          meta={meta.data}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}

export function Logs() {
  const [filter, setFilter] = useState({ level: '', action: '', page: 1 });
  const [action, setAction] = useState('');
  const { data, loading } = useApi('/admin/logs', filter);
  return (
    <div>
      <h1 className="admin-title">System logs</h1>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, action, page: 1 });
        }}
      >
        <input className="grow" placeholder="Action prefix, e.g. auth, document, user.update" value={action} onChange={(e) => setAction(e.target.value)} />
        <select value={filter.level} onChange={(e) => setFilter({ ...filter, level: e.target.value, page: 1 })}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr><th>Time</th><th>Level</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th>IP</th></tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="small nowrap">{formatDateTime(l.timestamp)}</td>
                      <td><span className={`badge badge-${l.level}`}>{l.level}</span></td>
                      <td><code>{l.action}</code></td>
                      <td>{l.actor_name}</td>
                      <td className="small">{l.target_type} {l.target_id && <span className="muted">{l.target_id.slice(-6)}</span>}</td>
                      <td className="small details">{l.details && Object.keys(l.details).length ? JSON.stringify(l.details) : ''}</td>
                      <td className="small muted">{l.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => setFilter({ ...filter, page: p })} />
          </>
        )
      )}
    </div>
  );
}

export function SearchLogs() {
  const [filter, setFilter] = useState({ event: '', q: '', page: 1 });
  const [q, setQ] = useState('');
  const { data, loading } = useApi('/admin/search-logs', filter);
  return (
    <div>
      <h1 className="admin-title">Search & click logs</h1>
      <p className="muted small">
        Collected for Phase 2 (ranking evaluation). Each search is stored with <code>clicked_doc_id = null</code>; each result click
        is stored with the clicked document and its position.
      </p>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, q, page: 1 });
        }}
      >
        <input className="grow" placeholder="Query contains…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter.event} onChange={(e) => setFilter({ ...filter, event: e.target.value, page: 1 })}>
          <option value="">Searches & clicks</option>
          <option value="search">Searches only</option>
          <option value="click">Clicks only</option>
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr><th>Timestamp</th><th>Event</th><th>user_id</th><th>query_string</th><th>clicked_doc_id</th><th className="num">Results / Pos.</th></tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="small nowrap">{formatDateTime(l.timestamp)}</td>
                      <td><span className={`badge badge-${l.event === 'click' ? 'published' : 'draft'}`}>{l.event}</span></td>
                      <td className="small">{l.user_id ? l.user_id.username : <span className="muted">anonymous</span>}</td>
                      <td><code>{l.query_string}</code></td>
                      <td className="small">
                        {l.clicked_doc_id ? <a href={`/article/${l.clicked_doc_id.slug}`} target="_blank" rel="noreferrer">{l.clicked_doc_id.title}</a> : <span className="muted">null</span>}
                      </td>
                      <td className="num">{l.event === 'click' ? `#${l.position ?? '?'}` : l.results_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => setFilter({ ...filter, page: p })} />
          </>
        )
      )}
    </div>
  );
}

export function Settings() {
  const { reloadSettings } = useAuth();
  const { data, loading } = useApi('/admin/settings');
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, ok: false });

  useEffect(() => {
    if (data) setForm({ ...data.settings, banned_words: (data.settings.banned_words || []).join(', ') });
  }, [data]);

  if (loading || !form) return <Spinner />;

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null, ok: false });
    try {
      await api('/admin/settings', { method: 'PUT', body: form });
      await reloadSettings();
      setState({ busy: false, error: null, ok: true });
    } catch (error) {
      setState({ busy: false, error, ok: false });
    }
  };

  return (
    <form className="form settings" onSubmit={save}>
      <div className="admin-head">
        <h1 className="admin-title">Global settings</h1>
        <button className="btn btn-primary" disabled={state.busy}>Save settings</button>
      </div>
      <ErrorMessage error={state.error} />
      {state.ok && <div className="alert alert-success">Settings saved.</div>}
      <div className="two-col">
        <div className="card">
          <h2>Site</h2>
          <label>Site name<input value={form.site_name} onChange={set('site_name')} required /></label>
          <label>Tagline<input value={form.tagline} onChange={set('tagline')} /></label>
          <label>Footer text<input value={form.footer_text} onChange={set('footer_text')} /></label>
          <label>Articles per page<input type="number" min={3} max={50} value={form.items_per_page} onChange={set('items_per_page')} /></label>
          <label className="check"><input type="checkbox" checked={form.allow_registration} onChange={set('allow_registration')} /> Allow new registrations</label>
        </div>
        <div className="card">
          <h2>Comments & spam control</h2>
          <label>
            Comment policy
            <select value={form.comment_policy} onChange={set('comment_policy')}>
              <option value="open">Publish immediately</option>
              <option value="approval">Require moderator approval</option>
            </select>
          </label>
          <label>
            Blocked words <span className="hint">(comma separated; matching comments are held for review)</span>
            <textarea rows={3} value={form.banned_words} onChange={set('banned_words')} />
          </label>
          <label>Max links per comment (more = spam)<input type="number" min={0} max={20} value={form.max_links_per_comment} onChange={set('max_links_per_comment')} /></label>
          <label>Auto-hide after N reports<input type="number" min={1} max={50} value={form.auto_hide_flag_threshold} onChange={set('auto_hide_flag_threshold')} /></label>
        </div>
      </div>
      <p className="small muted">Last updated {formatDate(form.updated_at)}</p>
    </form>
  );
}

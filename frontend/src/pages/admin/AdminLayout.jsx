import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApi } from '../../hooks';
import { ROLE_LABELS, compact, setPageMeta } from '../../utils';

export const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', end: true, perms: null },
  { to: '/admin/articles', label: 'Articles', perms: ['content:manage'] },
  { to: '/admin/taxonomy', label: 'Categories & Tags', perms: ['taxonomy:manage'] },
  { to: '/admin/comments', label: 'Comments', perms: ['comments:moderate'] },
  { to: '/admin/reports', label: 'Reports', perms: ['reports:handle'] },
  { to: '/admin/seo', label: 'SEO metadata', perms: ['seo:manage'] },
  { to: '/admin/analytics', label: 'Analytics', perms: ['analytics:view'] },
  { to: '/admin/users', label: 'Users & Roles', perms: ['users:manage'] },
  { to: '/admin/logs', label: 'System logs', perms: ['logs:view'] },
  { to: '/admin/search-logs', label: 'Search logs', perms: ['logs:view', 'analytics:view'] },
  { to: '/admin/settings', label: 'Settings', perms: ['settings:manage'] },
];

export default function AdminLayout() {
  const { user, can } = useAuth();
  useEffect(() => setPageMeta('Admin dashboard'), []);
  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-user">
          <strong>{user.display_name}</strong>
          <span className="badge badge-role">{ROLE_LABELS[user.role]}</span>
        </div>
        <nav>
          {ADMIN_NAV.filter((n) => !n.perms || can(...n.perms)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="small muted back-site">← Back to site</Link>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  );
}

function Tile({ label, value, to }) {
  const body = (
    <>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </>
  );
  return to ? <Link to={to} className="tile">{body}</Link> : <div className="tile">{body}</div>;
}

export function Dashboard() {
  const { user, can } = useAuth();
  const content = useApi(can('content:manage', 'seo:manage') ? '/manage/documents' : null, { limit: 5 });
  const drafts = useApi(can('content:manage') ? '/manage/documents' : null, { status: 'draft', limit: 1 });
  const mod = useApi(can('comments:moderate', 'reports:handle') ? '/moderation/stats' : null);
  const analytics = useApi(can('analytics:view') ? '/analytics/overview' : null, { days: 30 });
  const users = useApi(can('users:manage') ? '/admin/users' : null, { limit: 1 });

  return (
    <div>
      <h1 className="admin-title">Welcome back, {user.display_name}</h1>
      <p className="muted">
        You are signed in as <strong>{ROLE_LABELS[user.role]}</strong>. Your permissions:{' '}
        {user.effective_permissions.map((p) => (
          <code key={p} className="perm">{p}</code>
        ))}
      </p>

      <div className="tiles">
        {content.data && <Tile label="Articles (all statuses)" value={content.data.total} to={can('content:manage') ? '/admin/articles' : '/admin/seo'} />}
        {drafts.data && <Tile label="Drafts" value={drafts.data.total} to="/admin/articles?status=draft" />}
        {mod.data && can('comments:moderate') && <Tile label="Comments awaiting review" value={mod.data.comments.pending} to="/admin/comments?status=pending" />}
        {mod.data && can('comments:moderate') && <Tile label="Comments marked spam" value={mod.data.comments.spam} to="/admin/comments?status=spam" />}
        {mod.data && can('reports:handle') && <Tile label="Open reports" value={mod.data.open_reports} to="/admin/reports" />}
        {analytics.data && <Tile label="Total views" value={compact(analytics.data.totals.views)} to="/admin/analytics" />}
        {analytics.data && <Tile label="Search CTR (30 days)" value={`${analytics.data.totals.ctr}%`} to="/admin/analytics" />}
        {users.data && <Tile label="Registered users" value={users.data.total} to="/admin/users" />}
      </div>

      {content.data && (
        <div className="card">
          <h2>Recently updated articles</h2>
          <table className="table">
            <tbody>
              {content.data.items.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td><span className={`badge badge-${d.status}`}>{d.status}</span></td>
                  <td className="muted small">{new Date(d.updated_at).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

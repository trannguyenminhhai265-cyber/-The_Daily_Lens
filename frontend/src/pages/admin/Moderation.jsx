// Moderator screens: comment review queue and reports/flags.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { ErrorMessage, MentionText, Pagination, Spinner, StatusBadge, UserLink } from '../../components/common';
import { useApi } from '../../hooks';
import { formatDateTime } from '../../utils';

const STATUSES = ['pending', 'spam', 'visible', 'hidden'];

export function Comments() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'pending';
  const page = Number(params.get('page')) || 1;
  const flagged = params.get('flagged') === 'true';
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState(null);
  const stats = useApi('/moderation/stats');
  const { data, loading, reload } = useApi('/moderation/comments', {
    status: status === 'all' ? '' : status,
    page,
    q: params.get('q') || '',
    flagged: flagged ? 'true' : '',
  });

  const refresh = () => {
    setSelected([]);
    reload();
    stats.reload();
  };
  const run = async (fn) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e);
    }
  };
  const setStatus = (id, s) => run(() => api(`/moderation/comments/${id}`, { method: 'PATCH', body: { status: s } }));
  const bulk = (s) => run(() => api('/moderation/comments/bulk', { method: 'POST', body: { ids: selected, status: s } }));
  const remove = (id) => window.confirm('Delete this comment permanently?') && run(() => api(`/moderation/comments/${id}`, { method: 'DELETE' }));
  const mute = (u) => run(() => api(`/moderation/users/${u.id}/mute`, { method: 'PATCH', body: { is_muted: !u.is_muted } }));

  const items = data ? data.items : [];
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const counts = stats.data ? stats.data.comments : {};

  return (
    <div>
      <h1 className="admin-title">Comment moderation</h1>
      <div className="tabs">
        {[...STATUSES, 'all'].map((s) => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setParams({ status: s })}>
            {s} {counts[s] !== undefined && <span className="count">{counts[s]}</span>}
          </button>
        ))}
      </div>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ status, ...(q ? { q } : {}) });
        }}
      >
        <input className="grow" placeholder="Search comment text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={flagged} onChange={(e) => setParams({ status, ...(e.target.checked ? { flagged: 'true' } : {}) })} />
          Flagged only
        </label>
        <button className="btn btn-ghost">Search</button>
      </form>
      <ErrorMessage error={error} />
      {selected.length > 0 && (
        <div className="bulk-bar">
          {selected.length} selected:
          <button className="btn btn-sm btn-primary" onClick={() => bulk('visible')}>Approve</button>
          <button className="btn btn-sm btn-ghost" onClick={() => bulk('hidden')}>Hide</button>
          <button className="btn btn-sm btn-ghost" onClick={() => bulk('spam')}>Mark spam</button>
        </div>
      )}
      {loading && !data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="muted">No comments in this queue. 🎉</p>
      ) : (
        <ul className="mod-list">
          {items.map((c) => (
            <li key={c.id} className="mod-item">
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} aria-label="Select comment" />
              <div className="mod-main">
                <div className="small muted">
                  <UserLink user={c.user_id} /> {c.user_id && c.user_id.is_muted && <span className="badge badge-hidden">muted</span>} on{' '}
                  {c.document_id ? <Link to={`/article/${c.document_id.slug}`}>{c.document_id.title}</Link> : 'deleted article'} ·{' '}
                  {formatDateTime(c.created_at)}
                </div>
                <p><MentionText text={c.content} /></p>
                <div className="small">
                  <StatusBadge status={c.status} />
                  {c.flags_count > 0 && <span className="badge badge-flag">{c.flags_count} flags</span>}
                  {c.moderation_reason && <span className="muted"> {c.moderation_reason}</span>}
                </div>
              </div>
              <div className="row-actions">
                {c.status !== 'visible' && <button onClick={() => setStatus(c.id, 'visible')}>Approve</button>}
                {c.status !== 'hidden' && <button onClick={() => setStatus(c.id, 'hidden')}>Hide</button>}
                {c.status !== 'spam' && <button onClick={() => setStatus(c.id, 'spam')}>Spam</button>}
                {c.user_id && c.user_id.role === 'user' && <button onClick={() => mute(c.user_id)}>{c.user_id.is_muted ? 'Unmute user' : 'Mute user'}</button>}
                <button className="danger" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} pages={data.pages} onChange={(p) => setParams({ status, page: String(p) })} />}
    </div>
  );
}

function ReportItem({ report, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const handle = async (status, action) => {
    try {
      await api(`/moderation/reports/${report.id}`, { method: 'PATCH', body: { status, action, resolution_note: note } });
      onDone();
    } catch (e) {
      setError(e);
    }
  };
  const t = report.target;
  return (
    <li className="mod-item report">
      <div className="mod-main">
        <div className="small muted">
          <strong className="badge badge-flag">{report.reason}</strong> reported by <UserLink user={report.reporter_id} /> ·{' '}
          {formatDateTime(report.created_at)}
        </div>
        {report.details && <p className="small">“{report.details}”</p>}
        <div className="report-target">
          {!t ? (
            <span className="muted">The reported item no longer exists.</span>
          ) : report.target_type === 'comment' ? (
            <>
              <div className="small muted">
                Comment by <UserLink user={t.user_id} /> on {t.document_id ? <Link to={`/article/${t.document_id.slug}`}>{t.document_id.title}</Link> : '—'}{' '}
                <StatusBadge status={t.status} />
              </div>
              <p><MentionText text={t.content} /></p>
            </>
          ) : (
            <div className="small">
              Article: <Link to={`/article/${t.slug}`}>{t.title}</Link> <StatusBadge status={t.status} />
            </div>
          )}
        </div>
        {report.status === 'open' ? (
          <div className="report-actions">
            <input className="grow" placeholder="Resolution note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {report.target_type === 'comment' && t && (
              <>
                <button className="btn btn-sm btn-primary" onClick={() => handle('resolved', 'hide_target')}>Hide comment</button>
                <button className="btn btn-sm btn-ghost" onClick={() => handle('resolved', 'mute_author')}>Mute author</button>
              </>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => handle('resolved')}>Mark resolved</button>
            <button className="btn btn-sm btn-ghost" onClick={() => handle('dismissed')}>Dismiss</button>
          </div>
        ) : (
          <div className="small muted">
            <StatusBadge status={report.status} /> by {report.handled_by ? report.handled_by.display_name : '—'}
            {report.resolution_note && ` — ${report.resolution_note}`}
          </div>
        )}
        <ErrorMessage error={error} />
      </div>
    </li>
  );
}

export function Reports() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useApi('/moderation/reports', { status, page });
  return (
    <div>
      <h1 className="admin-title">Reports & flags</h1>
      <div className="tabs">
        {['open', 'resolved', 'dismissed'].map((s) => (
          <button
            key={s}
            className={status === s ? 'active' : ''}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <p className="muted">No {status} reports.</p>
      ) : (
        <ul className="mod-list">
          {(data ? data.items : []).map((r) => (
            <ReportItem key={r.id} report={r} onDone={reload} />
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
    </div>
  );
}

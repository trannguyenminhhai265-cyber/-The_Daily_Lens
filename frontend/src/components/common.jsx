import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials } from '../utils';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}

export function ErrorMessage({ error }) {
  if (!error) return null;
  return <div className="alert alert-error">{error.message || String(error)}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Avatar({ user, size = 36 }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size }}>?</span>;
  if (user.avatar_url) {
    return <img className="avatar" src={user.avatar_url} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(user.display_name || user.username)}
    </span>
  );
}

export function UserLink({ user }) {
  if (!user) return <span className="muted">Deleted user</span>;
  return <Link to={`/u/${user.username}`}>{user.display_name || user.username}</Link>;
}

export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;
  const nums = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  for (let i = start; i <= end; i += 1) nums.push(i);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      {start > 1 && (
        <>
          <button onClick={() => onChange(1)}>1</button>
          {start > 2 && <span className="muted">…</span>}
        </>
      )}
      {nums.map((n) => (
        <button key={n} className={n === page ? 'active' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      {end < pages && (
        <>
          {end < pages - 1 && <span className="muted">…</span>}
          <button onClick={() => onChange(pages)}>{pages}</button>
        </>
      )}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>Next ›</button>
    </nav>
  );
}

/** Renders comment text with @mentions turned into profile links. */
export function MentionText({ text }) {
  const parts = String(text).split(/(@[a-z0-9_]{3,30})/gi);
  return parts.map((part, i) =>
    /^@[a-z0-9_]{3,30}$/i.test(part) ? (
      <Link key={i} className="mention" to={`/u/${part.slice(1).toLowerCase()}`}>
        {part}
      </Link>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function StarRating({ value = 0, onRate, size = 'md', label }) {
  return (
    <span className={`stars stars-${size}`} role={onRate ? 'radiogroup' : 'img'} aria-label={label || `Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onRate ? (
          <button
            key={n}
            type="button"
            className={n <= Math.round(value) ? 'on' : ''}
            onClick={() => onRate(n)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ) : (
          <span key={n} className={n <= Math.round(value) ? 'on' : ''}>★</span>
        )
      )}
    </span>
  );
}

export function RequireAuth({ children, permissions }) {
  const { user, ready, can } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (permissions && !can(...permissions)) {
    return (
      <div className="container narrow">
        <div className="alert alert-error">You do not have permission to view this page.</div>
      </div>
    );
  }
  return children;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

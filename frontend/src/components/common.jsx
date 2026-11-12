import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { initials } from "../utils";

export function Spinner({ label = "Đang tải…" }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}

export function ErrorMessage({ error }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">{error.message || String(error)}</div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Avatar({ user, size = 36 }) {
  if (!user)
    return (
      <span className="avatar" style={{ width: size, height: size }}>
        ?
      </span>
    );
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(user.display_name || user.username)}
    </span>
  );
}

export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;
  const nums = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  for (let i = start; i <= end; i += 1) nums.push(i);
  return (
    <nav className="pagination" aria-label="Phân trang">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹ Trước
      </button>
      {start > 1 && (
        <>
          <button onClick={() => onChange(1)}>1</button>
          {start > 2 && <span className="muted">…</span>}
        </>
      )}
      {nums.map((n) => (
        <button
          key={n}
          className={n === page ? "active" : ""}
          aria-current={n === page ? "page" : undefined}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      {end < pages && (
        <>
          {end < pages - 1 && <span className="muted">…</span>}
          <button onClick={() => onChange(pages)}>{pages}</button>
        </>
      )}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Sau ›
      </button>
    </nav>
  );
}

export function RequireAuth({ children, adminOnly = false }) {
  const { user, ready, isAdmin } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  if (adminOnly && !isAdmin) {
    return (
      <div className="container narrow">
        <div className="alert alert-error">
          Bạn không có quyền xem trang này.
        </div>
      </div>
    );
  }
  return children;
}

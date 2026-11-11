import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api";
import { ErrorMessage, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { compact, setPageMeta } from "../../utils";

const NAV = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/articles", label: "Articles" },
  { to: "/admin/taxonomy", label: "Categories & tags" },
  { to: "/admin/search-logs", label: "Search logs" },
];
export default function AdminLayout() {
  const { user } = useAuth();
  useEffect(() => setPageMeta("Admin dashboard"), []);
  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-user">
          <strong>{user.display_name}</strong>
          <span className="badge badge-role">Admin</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="small muted back-site">
          ← Back to site
        </Link>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  );
}
export function Dashboard() {
  const { data, loading, error } = useApi("/admin/stats");
  const [exportState, setExportState] = useState({ busy: false, error: null });
  const download = async () => {
    setExportState({ busy: true, error: null });
    try {
      const data = await api("/admin/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data.items, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState({ busy: false, error: null });
    } catch (error) {
      setExportState({ busy: false, error });
    }
  };
  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Dataset overview</h1>
        <button
          className="btn btn-primary"
          disabled={exportState.busy}
          onClick={download}
        >
          {exportState.busy ? "Exporting…" : "Download dataset JSON"}
        </button>
      </div>
      <ErrorMessage error={error || exportState.error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <div className="tiles">
            {[
              ["documents", "Articles", "/admin/articles"],
              ["categories", "Categories", "/admin/taxonomy"],
              ["tags", "Tags", "/admin/taxonomy"],
              ["searches", "Searches", "/admin/search-logs"],
              ["clicks", "Clicks", "/admin/search-logs"],
            ].map(([key, label, to]) => (
              <Link key={key} to={to} className="tile">
                <span className="tile-value">{compact(data.totals[key])}</span>
                <span className="tile-label">{label}</span>
              </Link>
            ))}
          </div>
        )
      )}
      <p className="muted small">
        Search logs include synthetic seed data. Use the source filter when
        reviewing recorded searches.
      </p>
    </div>
  );
}

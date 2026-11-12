import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api";
import { ErrorMessage, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { compact, setPageMeta } from "../../utils";

const NAV = [
  { to: "/admin", label: "Tổng quan", end: true },
  { to: "/admin/articles", label: "Bài viết" },
  { to: "/admin/taxonomy", label: "Chuyên mục & thẻ" },
  { to: "/admin/search-logs", label: "Nhật ký tìm kiếm" },
];
export default function AdminLayout() {
  const { user } = useAuth();
  useEffect(() => setPageMeta("Trang quản trị"), []);
  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-user">
          <strong>{user.display_name}</strong>
          <span className="badge badge-role">Quản trị viên</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="small muted back-site">
          ← Về trang web
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
        <h1 className="admin-title">Tổng quan dữ liệu</h1>
        <button
          className="btn btn-primary"
          disabled={exportState.busy}
          onClick={download}
        >
          {exportState.busy ? "Đang xuất…" : "Tải dữ liệu JSON"}
        </button>
      </div>
      <ErrorMessage error={error || exportState.error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <div className="tiles">
            {[
              ["documents", "Bài viết", "/admin/articles"],
              ["categories", "Chuyên mục", "/admin/taxonomy"],
              ["tags", "Thẻ", "/admin/taxonomy"],
              ["searches", "Lượt tìm kiếm", "/admin/search-logs"],
              ["clicks", "Lượt nhấp", "/admin/search-logs"],
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
        Nhật ký tìm kiếm có chứa dữ liệu giả lập. Hãy dùng bộ lọc nguồn khi
        xem các lượt tìm kiếm thực tế.
      </p>
    </div>
  );
}

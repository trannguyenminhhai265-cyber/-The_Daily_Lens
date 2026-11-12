import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks";
import { categoryLabel } from "../utils";
import { Avatar } from "./common";

function Header() {
  const { user, settings, logout, isAdmin } = useAuth();
  const { data } = useApi("/categories");
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  const submit = (e) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    setQ("");
  };

  return (
    <header className="site-header">
      <div className="topbar container">
        <button
          className="icon-btn menu-toggle"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Bật/tắt menu"
        >
          ☰
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark">L</span>
          <span className="brand-name">{settings.site_name}</span>
        </Link>
        <form className="header-search" onSubmit={submit} role="search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm bài viết…"
            aria-label="Tìm bài viết"
          />
          <button type="submit" aria-label="Tìm kiếm">
            ⌕
          </button>
        </form>
        <div className="user-area">
          {user ? (
            <div className="user-menu">
              <button
                className="user-btn"
                onClick={() => setUserOpen((v) => !v)}
                aria-expanded={userOpen}
              >
                <Avatar user={user} size={32} />
                <span className="hide-sm">{user.display_name}</span>
              </button>
              {userOpen && (
                <div className="dropdown">
                  <Link to="/profile">Hồ sơ của tôi</Link>
                  {isAdmin && <Link to="/admin">Trang quản trị</Link>}
                  <button
                    onClick={() => {
                      logout();
                      navigate("/");
                    }}
                  >
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">
                Đăng nhập
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm hide-sm">
                Đăng ký
              </Link>
            </>
          )}
        </div>
      </div>
      <nav
        className={`cat-nav ${menuOpen ? "open" : ""}`}
        aria-label="Chuyên mục"
      >
        <div className="container cat-nav-inner">
          <NavLink to="/" end>
            Mới nhất
          </NavLink>
          {(data ? data.items : []).map((c) => (
            <NavLink key={c.id} to={`/category/${c.slug}`}>
              {categoryLabel(c)}
            </NavLink>
          ))}
          <NavLink to="/search">Tìm kiếm</NavLink>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const { settings } = useAuth();
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div>
          <div className="brand footer-brand">
            <span className="brand-mark">L</span>
            <span className="brand-name">{settings.site_name}</span>
          </div>
          <p className="muted">{settings.tagline}</p>
        </div>
        <div className="footer-links">
          <Link to="/search">Tìm kiếm</Link>
          <Link to="/register">Tạo tài khoản</Link>
        </div>
      </div>
      <div className="container muted small footer-copy">
        {settings.footer_text ||
          `© ${new Date().getFullYear()} ${settings.site_name}. Dự án demo phục vụ mục đích học tập.`}
      </div>
    </footer>
  );
}

export default function Layout() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <Header />
      <main className="site-main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

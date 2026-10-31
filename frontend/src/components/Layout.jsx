import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { Avatar } from './common';

function Header() {
  const { user, settings, logout, isStaff } = useAuth();
  const { data } = useApi('/categories');
  const [q, setQ] = useState('');
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
    setQ('');
  };

  return (
    <header className="site-header">
      <div className="topbar container">
        <button className="icon-btn menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu">
          ☰
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark">L</span>
          <span className="brand-name">{settings.site_name}</span>
        </Link>
        <form className="header-search" onSubmit={submit} role="search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" aria-label="Search articles" />
          <button type="submit" aria-label="Search">⌕</button>
        </form>
        <div className="user-area">
          {user ? (
            <div className="user-menu">
              <button className="user-btn" onClick={() => setUserOpen((v) => !v)} aria-expanded={userOpen}>
                <Avatar user={user} size={32} />
                <span className="hide-sm">{user.display_name}</span>
              </button>
              {userOpen && (
                <div className="dropdown">
                  <Link to="/profile">My profile</Link>
                  <Link to={`/u/${user.username}`}>Public page</Link>
                  {isStaff && <Link to="/admin">Admin dashboard</Link>}
                  <button
                    onClick={() => {
                      logout();
                      navigate('/');
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-primary btn-sm hide-sm">Join</Link>
            </>
          )}
        </div>
      </div>
      <nav className={`cat-nav ${menuOpen ? 'open' : ''}`} aria-label="Categories">
        <div className="container cat-nav-inner">
          <NavLink to="/" end>Latest</NavLink>
          {(data ? data.items : []).map((c) => (
            <NavLink key={c.id} to={`/category/${c.slug}`}>
              {c.name}
            </NavLink>
          ))}
          <NavLink to="/search">Search</NavLink>
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
          <Link to="/search">Search</Link>
          <a href="/sitemap.xml">Sitemap</a>
          <Link to="/register">Create account</Link>
        </div>
      </div>
      <div className="container muted small footer-copy">
        {settings.footer_text || `© ${new Date().getFullYear()} ${settings.site_name}. Demo project for educational purposes.`}
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

import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ArticleCard from '../components/ArticleCard';
import { ErrorMessage, Pagination, Spinner } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { setPageMeta } from '../utils';

export default function Home() {
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page')) || 1;

  const latest = useApi('/documents', { page });
  const featured = useApi('/documents', { featured: 'true', limit: 3 });
  const popular = useApi('/documents', { sort: 'popular', limit: 5 });
  const categories = useApi('/categories');
  const tags = useApi('/tags');

  useEffect(() => {
    setPageMeta(`${settings.site_name} — ${settings.tagline}`, settings.tagline);
  }, [settings]);

  const changePage = (p) => {
    setParams(p > 1 ? { page: String(p) } : {});
    document.getElementById('latest')?.scrollIntoView({ behavior: 'smooth' });
  };

  const featuredItems = featured.data ? featured.data.items : [];
  const topTags = tags.data ? [...tags.data.items].sort((a, b) => b.count - a.count).slice(0, 18) : [];

  return (
    <div className="container">
      {page === 1 && featuredItems.length > 0 && (
        <section className="featured-grid">
          <ArticleCard doc={featuredItems[0]} variant="hero" />
          <div className="featured-side">
            {featuredItems.slice(1).map((d) => (
              <ArticleCard key={d.id} doc={d} variant="row" />
            ))}
          </div>
        </section>
      )}

      <div className="with-sidebar">
        <section id="latest">
          <h2 className="section-title">Latest stories</h2>
          <ErrorMessage error={latest.error} />
          {latest.loading && !latest.data ? (
            <Spinner />
          ) : (
            <>
              <div className="card-grid">
                {(latest.data ? latest.data.items : []).map((d) => (
                  <ArticleCard key={d.id} doc={d} />
                ))}
              </div>
              {latest.data && <Pagination page={latest.data.page} pages={latest.data.pages} onChange={changePage} />}
            </>
          )}
        </section>

        <aside className="sidebar">
          <div className="side-block">
            <h3 className="side-title">Most read</h3>
            <ol className="ranked">
              {(popular.data ? popular.data.items : []).map((d) => (
                <li key={d.id}>
                  <ArticleCard doc={d} variant="mini" />
                </li>
              ))}
            </ol>
          </div>
          <div className="side-block">
            <h3 className="side-title">Sections</h3>
            <ul className="cat-list">
              {(categories.data ? categories.data.items : []).map((c) => (
                <li key={c.id}>
                  <Link to={`/category/${c.slug}`}>
                    <span className="dot" style={{ background: c.color }} />
                    {c.name}
                    <span className="muted">{c.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="side-block">
            <h3 className="side-title">Popular tags</h3>
            <div className="tag-cloud">
              {topTags.map((t) => (
                <Link key={t.id} to={`/tag/${t.slug}`} className="tag">
                  #{t.name}
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

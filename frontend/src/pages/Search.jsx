import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ArticleCard from '../components/ArticleCard';
import { Empty, ErrorMessage, Pagination, Spinner } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { setPageMeta } from '../utils';

/**
 * Search & directory page. Also serves /category/:slug and /tag/:slug.
 * Phase 1 search uses regex matching on the server; every query and result click is logged
 * to the search_logs collection for the Phase 2 ranking engine.
 */
export default function Search({ mode }) {
  const { slug } = useParams();
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const categories = useApi('/categories');
  const tags = useApi('/tags');

  const filters = {
    q: params.get('q') || '',
    category: mode === 'category' ? slug : params.get('category') || '',
    tag: mode === 'tag' ? slug : params.get('tag') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    sort: params.get('sort') || 'latest',
    page: Number(params.get('page')) || 1,
  };
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [params.toString(), slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading, error } = useApi('/documents', filters);

  const category = categories.data && categories.data.items.find((c) => c.slug === filters.category);
  const tag = tags.data && tags.data.items.find((t) => t.slug === filters.tag);
  const heading = mode === 'category' && category ? category.name : mode === 'tag' && tag ? `#${tag.name}` : 'Search';

  useEffect(() => {
    setPageMeta(`${heading} | ${settings.site_name}`, category ? category.description : undefined);
  }, [heading, settings.site_name, category]);

  const apply = (next) => {
    const merged = { ...draft, ...next };
    const out = {};
    for (const key of ['q', 'from', 'to', 'sort', 'page']) {
      if (merged[key] && !(key === 'sort' && merged[key] === 'latest') && !(key === 'page' && merged[key] === 1)) {
        out[key] = String(merged[key]);
      }
    }
    if (mode !== 'category' && merged.category) out.category = merged.category;
    if (mode !== 'tag' && merged.tag) out.tag = merged.tag;
    setParams(out);
  };

  const logClick = (doc, index) => () => {
    if (!filters.q) return;
    api('/search/click', {
      method: 'POST',
      body: { query_string: filters.q, clicked_doc_id: doc.id, position: (filters.page - 1) * (data.limit || 10) + index + 1 },
    }).catch(() => {});
  };

  const clear = () => {
    setDraft({ q: '', category: '', tag: '', from: '', to: '', sort: 'latest', page: 1 });
    setParams({});
  };

  return (
    <div className="container">
      <header className="page-header">
        <h1>{heading}</h1>
        {mode === 'category' && category && <p className="muted">{category.description}</p>}
      </header>

      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ page: 1 });
        }}
      >
        <input
          className="grow"
          type="search"
          placeholder="Keywords…"
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          aria-label="Keywords"
        />
        {mode !== 'category' && (
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {(categories.data ? categories.data.items : []).map((c) => (
              <option key={c.id} value={c.slug}>{c.name}</option>
            ))}
          </select>
        )}
        {mode !== 'tag' && (
          <select value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} aria-label="Tag">
            <option value="">All tags</option>
            {(tags.data ? tags.data.items : [])
              .filter((t) => t.count > 0)
              .map((t) => (
                <option key={t.id} value={t.slug}>{t.name} ({t.count})</option>
              ))}
          </select>
        )}
        <label className="inline-label">
          From
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label className="inline-label">
          To
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })} aria-label="Sort by">
          <option value="latest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="popular">Most viewed</option>
          <option value="top_rated">Top rated</option>
        </select>
        <button className="btn btn-primary">Apply</button>
        <button type="button" className="btn btn-ghost" onClick={clear}>Reset</button>
      </form>

      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <Empty>No articles match your search. Try different keywords or remove some filters.</Empty>
      ) : (
        data && (
          <>
            <p className="muted result-count">
              {data.total} result{data.total === 1 ? '' : 's'}
              {filters.q && (
                <>
                  {' '}for <strong>“{filters.q}”</strong>
                </>
              )}
            </p>
            <div className="list-results">
              {data.items.map((d, i) => (
                <ArticleCard key={d.id} doc={d} variant="row" onOpen={logClick(d, i)} />
              ))}
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => apply({ ...filters, page: p })} />
          </>
        )
      )}
    </div>
  );
}

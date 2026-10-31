// Content Manager screens: articles list, article editor, categories & tags.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { ErrorMessage, Pagination, Spinner, StatusBadge } from '../../components/common';
import { useAuth } from '../../context/AuthContext';
import { useApi } from '../../hooks';
import { compact, formatDate } from '../../utils';

export function Articles() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') || '',
    status: params.get('status') || '',
    category: params.get('category') || '',
    page: Number(params.get('page')) || 1,
  };
  const [q, setQ] = useState(filters.q);
  const { data, loading, error, reload } = useApi('/manage/documents', filters);
  const categories = useApi('/categories');
  const [actionError, setActionError] = useState(null);

  const update = (next) => {
    const merged = { ...filters, ...next };
    const out = {};
    Object.entries(merged).forEach(([k, v]) => {
      if (v && !(k === 'page' && v === 1)) out[k] = String(v);
    });
    setParams(out);
  };

  const run = async (fn) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    }
  };

  const setStatus = (doc, status) => run(() => api(`/manage/documents/${doc.id}/status`, { method: 'PATCH', body: { status } }));
  const remove = (doc) => {
    if (!window.confirm(`Delete "${doc.title}"? Comments, likes and ratings will be removed as well.`)) return;
    run(() => api(`/manage/documents/${doc.id}`, { method: 'DELETE' }));
  };

  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Articles</h1>
        <Link to="/admin/articles/new" className="btn btn-primary">+ New article</Link>
      </div>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q, page: 1 });
        }}
      >
        <input className="grow" placeholder="Search title or text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filters.status} onChange={(e) => update({ status: e.target.value, page: 1 })}>
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filters.category} onChange={(e) => update({ category: e.target.value, page: 1 })}>
          <option value="">All categories</option>
          {(categories.data ? categories.data.items : []).map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <button className="btn btn-ghost">Search</button>
      </form>
      <ErrorMessage error={error || actionError} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Published</th>
                    <th className="num">Views</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/admin/articles/${d.id}`}><strong>{d.title}</strong></Link>
                        <div className="small muted">by {d.author ? d.author.display_name : '—'} · {d.tags.map((t) => t.name).join(', ')}</div>
                      </td>
                      <td>{d.category_id ? d.category_id.name : '—'}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="small">{formatDate(d.published_at) || '—'}</td>
                      <td className="num">{compact(d.views_count)}</td>
                      <td className="row-actions">
                        {d.status === 'published' && <a href={`/article/${d.slug}`} target="_blank" rel="noreferrer">View</a>}
                        <Link to={`/admin/articles/${d.id}`}>Edit</Link>
                        {can('content:publish') &&
                          (d.status === 'published' ? (
                            <button onClick={() => setStatus(d, 'draft')}>Unpublish</button>
                          ) : (
                            <button onClick={() => setStatus(d, 'published')}>Publish</button>
                          ))}
                        <button className="danger" onClick={() => remove(d)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => update({ page: p })} />
          </>
        )
      )}
    </div>
  );
}

const EMPTY_ARTICLE = {
  title: '',
  summary: '',
  content: '',
  category_id: '',
  tags: '',
  status: 'draft',
  is_featured: false,
  cover_image: { url: '', alt: '', caption: '' },
};

export function ArticleEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { can } = useAuth();
  const categories = useApi('/categories');
  const [form, setForm] = useState(EMPTY_ARTICLE);
  const [loading, setLoading] = useState(!isNew);
  const [state, setState] = useState({ busy: false, error: null, saved: false });
  const [tab, setTab] = useState('write');

  useEffect(() => {
    if (isNew) return;
    api(`/manage/documents/${id}`)
      .then(({ document: d }) => {
        setForm({
          title: d.title,
          summary: d.summary,
          content: d.content,
          category_id: d.category_id ? d.category_id.id : '',
          tags: d.tags.map((t) => t.name).join(', '),
          status: d.status,
          is_featured: d.is_featured,
          cover_image: { url: d.cover_image.url, alt: d.cover_image.alt, caption: d.cover_image.caption },
          slug: d.slug,
        });
      })
      .catch((error) => setState((s) => ({ ...s, error })))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCover = (key) => (e) => setForm({ ...form, cover_image: { ...form.cover_image, [key]: e.target.value } });

  const insert = (before, after = '') => {
    const ta = document.getElementById('content-editor');
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const next = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    setForm({ ...form, content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, e + before.length);
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null, saved: false });
    try {
      const body = { ...form };
      delete body.slug;
      if (!can('content:publish')) delete body.status;
      const { document: d } = isNew
        ? await api('/manage/documents', { method: 'POST', body })
        : await api(`/manage/documents/${id}`, { method: 'PUT', body });
      setState({ busy: false, error: null, saved: true });
      if (isNew) navigate(`/admin/articles/${d.id}`, { replace: true });
      else setForm((f) => ({ ...f, slug: d.slug }));
    } catch (error) {
      setState({ busy: false, error, saved: false });
    }
  };

  if (loading) return <Spinner />;

  return (
    <form className="form editor" onSubmit={save}>
      <div className="admin-head">
        <h1 className="admin-title">{isNew ? 'New article' : 'Edit article'}</h1>
        <div className="row-actions">
          {!isNew && form.status === 'published' && (
            <a className="btn btn-ghost" href={`/article/${form.slug}`} target="_blank" rel="noreferrer">View live</a>
          )}
          <Link className="btn btn-ghost" to="/admin/articles">Back</Link>
          <button className="btn btn-primary" disabled={state.busy}>{state.busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <ErrorMessage error={state.error} />
      {state.saved && <div className="alert alert-success">Article saved.</div>}

      <div className="editor-grid">
        <div className="editor-main">
          <label>
            Title
            <input value={form.title} onChange={set('title')} maxLength={200} required />
          </label>
          <label>
            Summary <span className="hint">(shown in listings, 1–2 sentences)</span>
            <textarea rows={3} value={form.summary} onChange={set('summary')} maxLength={600} required />
          </label>
          <div className="tabs">
            <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Write (HTML)</button>
            <button type="button" className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
          </div>
          {tab === 'write' ? (
            <>
              <div className="toolbar">
                <button type="button" onClick={() => insert('<p>', '</p>')}>¶</button>
                <button type="button" onClick={() => insert('<h2>', '</h2>')}>H2</button>
                <button type="button" onClick={() => insert('<h3>', '</h3>')}>H3</button>
                <button type="button" onClick={() => insert('<strong>', '</strong>')}><b>B</b></button>
                <button type="button" onClick={() => insert('<em>', '</em>')}><i>I</i></button>
                <button type="button" onClick={() => insert('<blockquote>', '</blockquote>')}>❝</button>
                <button type="button" onClick={() => insert('<ul>\n  <li>', '</li>\n</ul>')}>• List</button>
                <button type="button" onClick={() => insert('<a href="https://">', '</a>')}>Link</button>
                <button type="button" onClick={() => insert('<img src="https://" alt="', '" />')}>Image</button>
              </div>
              <textarea id="content-editor" className="code" rows={18} value={form.content} onChange={set('content')} required />
            </>
          ) : (
            <div className="prose preview-box" dangerouslySetInnerHTML={{ __html: form.content }} />
          )}
        </div>

        <div className="editor-side">
          <div className="card">
            <label>
              Status
              <select value={form.status} onChange={set('status')} disabled={!can('content:publish')}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.is_featured} onChange={set('is_featured')} /> Featured on home page
            </label>
          </div>
          <div className="card">
            <label>
              Category
              <select value={form.category_id} onChange={set('category_id')} required>
                <option value="">Choose…</option>
                {(categories.data ? categories.data.items : []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Tags <span className="hint">(comma separated; new tags are created)</span>
              <input value={form.tags} onChange={set('tags')} placeholder="Climate, Energy" />
            </label>
          </div>
          <div className="card">
            <label>
              Cover image URL
              <input value={form.cover_image.url} onChange={setCover('url')} placeholder="https://…" />
            </label>
            {form.cover_image.url && <img className="cover-preview" src={form.cover_image.url} alt="" />}
            <label>
              Alt text
              <input value={form.cover_image.alt} onChange={setCover('alt')} />
            </label>
            <label>
              Caption
              <input value={form.cover_image.caption} onChange={setCover('caption')} />
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}

function CategoryRow({ cat, onChange, others }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const save = async () => {
    try {
      await api(`/categories/${cat.id}`, { method: 'PUT', body: edit });
      setEdit(null);
      onChange();
    } catch (e) {
      setError(e);
    }
  };
  const remove = async () => {
    let qs = '';
    if (cat.count > 0) {
      const target = window.prompt(
        `"${cat.name}" has ${cat.count} article(s). Type the slug of the category to move them to:\n${others.map((o) => o.slug).join(', ')}`
      );
      if (!target) return;
      const found = others.find((o) => o.slug === target.trim());
      if (!found) return window.alert('Unknown category slug');
      qs = `?reassign_to=${found.id}`;
    } else if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api(`/categories/${cat.id}${qs}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <tr>
      {edit ? (
        <>
          <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
          <td><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></td>
          <td><input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></td>
          <td className="num">{cat.count}</td>
          <td className="row-actions">
            <button onClick={save}>Save</button>
            <button onClick={() => setEdit(null)}>Cancel</button>
          </td>
        </>
      ) : (
        <>
          <td><span className="dot" style={{ background: cat.color }} /> <strong>{cat.name}</strong> <span className="muted small">/{cat.slug}</span></td>
          <td className="small">{cat.description}</td>
          <td><code>{cat.color}</code></td>
          <td className="num">{cat.count}</td>
          <td className="row-actions">
            <button onClick={() => setEdit({ name: cat.name, description: cat.description, color: cat.color })}>Edit</button>
            <button className="danger" onClick={remove}>Delete</button>
            {error && <span className="error-text">{error.message}</span>}
          </td>
        </>
      )}
    </tr>
  );
}

export function Taxonomy() {
  const categories = useApi('/categories');
  const tags = useApi('/tags');
  const [newCat, setNewCat] = useState({ name: '', description: '', color: '#b4232a' });
  const [newTag, setNewTag] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [error, setError] = useState(null);

  const run = async (fn, after) => {
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      setError(e);
    }
  };

  const cats = categories.data ? categories.data.items : [];
  const tagItems = (tags.data ? tags.data.items : []).filter((t) => t.name.toLowerCase().includes(tagFilter.toLowerCase()));

  return (
    <div>
      <h1 className="admin-title">Categories & Tags</h1>
      <ErrorMessage error={error} />
      <div className="card">
        <h2>Categories</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Description</th><th>Color</th><th className="num">Articles</th><th /></tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <CategoryRow key={c.id} cat={c} onChange={categories.reload} others={cats.filter((o) => o.id !== c.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('/categories', { method: 'POST', body: newCat }), () => {
              setNewCat({ name: '', description: '', color: '#b4232a' });
              categories.reload();
            });
          }}
        >
          <input placeholder="New category name" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required />
          <input className="grow" placeholder="Description" value={newCat.description} onChange={(e) => setNewCat({ ...newCat, description: e.target.value })} />
          <input type="color" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} aria-label="Color" />
          <button className="btn btn-primary">Add category</button>
        </form>
      </div>

      <div className="card">
        <h2>Tags ({tags.data ? tags.data.items.length : 0})</h2>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('/tags', { method: 'POST', body: { name: newTag } }), () => {
              setNewTag('');
              tags.reload();
            });
          }}
        >
          <input placeholder="New tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} required />
          <button className="btn btn-primary">Add tag</button>
          <input className="grow" placeholder="Filter tags…" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
        </form>
        <div className="tag-admin">
          {tagItems.map((t) => (
            <span key={t.id} className="tag tag-admin-item">
              {t.name} <span className="muted">({t.count})</span>
              <button
                title="Rename"
                onClick={() => {
                  const name = window.prompt('Rename tag', t.name);
                  if (name && name !== t.name) run(() => api(`/tags/${t.id}`, { method: 'PUT', body: { name } }), tags.reload);
                }}
              >
                ✎
              </button>
              <button
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete tag "${t.name}"? It will be removed from ${t.count} article(s).`)) {
                    run(() => api(`/tags/${t.id}`, { method: 'DELETE' }), tags.reload);
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../../api";
import { ErrorMessage, Pagination, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { compact, formatDate } from "../../utils";

export function Articles() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get("q") || "",
    category: params.get("category") || "",
    page: Number(params.get("page")) || 1,
  };
  const [q, setQ] = useState(filters.q);
  const { data, loading, error, reload } = useApi("/manage/documents", filters);
  const categories = useApi("/categories");
  const [actionError, setActionError] = useState(null);
  const update = (next) => {
    const out = {};
    Object.entries({ ...filters, ...next }).forEach(([k, v]) => {
      if (v && !(k === "page" && v === 1)) out[k] = String(v);
    });
    setParams(out);
  };
  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    setActionError(null);
    try {
      await api(`/manage/documents/${doc.id}`, { method: "DELETE" });
      reload();
    } catch (error) {
      setActionError(error);
    }
  };
  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Articles</h1>
        <Link to="/admin/articles/new" className="btn btn-primary">
          + New article
        </Link>
      </div>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q, page: 1 });
        }}
      >
        <input
          className="grow"
          placeholder="Search title or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          value={filters.category}
          onChange={(e) => update({ category: e.target.value, page: 1 })}
        >
          <option value="">All categories</option>
          {categories.data?.items.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
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
                    <th>Created</th>
                    <th className="num">Views</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/admin/articles/${d.id}`}>
                          <strong>{d.title}</strong>
                        </Link>
                        <div className="small muted">
                          {d.author?.display_name} ·{" "}
                          {d.tags.map((t) => t.name).join(", ")}
                        </div>
                      </td>
                      <td>{d.category_id?.name}</td>
                      <td>{formatDate(d.created_at)}</td>
                      <td className="num">{compact(d.views_count)}</td>
                      <td className="row-actions">
                        <Link to={`/article/${d.slug}`}>View</Link>
                        <Link to={`/admin/articles/${d.id}`}>Edit</Link>
                        <button className="danger" onClick={() => remove(d)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              pages={data.pages}
              onChange={(page) => update({ page })}
            />
          </>
        )
      )}
    </div>
  );
}

const EMPTY_ARTICLE = {
  title: "",
  summary: "",
  content: "",
  category_id: "",
  tags: "",
  cover_image: { url: "" },
  source_url: "",
};
export function ArticleEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const categories = useApi("/categories");
  const [form, setForm] = useState(EMPTY_ARTICLE);
  const [loading, setLoading] = useState(!isNew);
  const [state, setState] = useState({
    busy: false,
    error: null,
    saved: false,
  });
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (isNew) {
      setForm(EMPTY_ARTICLE);
      setLoading(false);
      return;
    }
    setLoading(true);
    api(`/manage/documents/${id}`)
      .then(({ document: d }) =>
        setForm({
          title: d.title,
          summary: d.summary,
          content: d.content,
          category_id: d.category_id?.id || "",
          tags: d.tags.map((t) => t.name).join(", "),
          cover_image: { url: d.cover_image?.url || "" },
          source_url: d.source_url || "",
          slug: d.slug,
        }),
      )
      .catch((error) => setState((s) => ({ ...s, error })))
      .finally(() => setLoading(false));
  }, [id, isNew]);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null, saved: false });
    try {
      const { slug, ...body } = form;
      const { document: d } = await api(
        isNew ? "/manage/documents" : `/manage/documents/${id}`,
        { method: isNew ? "POST" : "PUT", body },
      );
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
        <h1 className="admin-title">
          {isNew ? "New article" : "Edit article"}
        </h1>
        <div className="row-actions">
          {form.slug && (
            <Link className="btn btn-ghost" to={`/article/${form.slug}`}>
              View
            </Link>
          )}
          <Link className="btn btn-ghost" to="/admin/articles">
            Back
          </Link>
          <button className="btn btn-primary" disabled={state.busy}>
            {state.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <ErrorMessage error={state.error} />
      {state.saved && <div className="alert alert-success">Article saved.</div>}
      <div className="editor-grid">
        <div className="editor-main">
          <label>
            Title
            <input
              value={form.title}
              onChange={set("title")}
              maxLength={200}
              required
            />
          </label>
          <label>
            Summary
            <textarea
              rows={3}
              value={form.summary}
              onChange={set("summary")}
              maxLength={600}
              required
            />
          </label>
          <div className="tabs">
            <button
              type="button"
              className={!preview ? "active" : ""}
              onClick={() => setPreview(false)}
            >
              Content (HTML)
            </button>
            <button
              type="button"
              className={preview ? "active" : ""}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
          </div>
          {preview ? (
            <div
              className="prose preview-box"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(form.content),
              }}
            />
          ) : (
            <textarea
              className="code"
              rows={20}
              value={form.content}
              onChange={set("content")}
              required
            />
          )}
        </div>
        <div className="editor-side">
          <div className="card">
            <label>
              Category
              <select
                value={form.category_id}
                onChange={set("category_id")}
                required
              >
                <option value="">Choose…</option>
                {categories.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tags
              <input
                value={form.tags}
                onChange={set("tags")}
                placeholder="Comma-separated names"
              />
            </label>
          </div>
          <div className="card">
            <label>
              Cover image URL
              <input
                type="url"
                value={form.cover_image.url}
                onChange={(e) =>
                  setForm({ ...form, cover_image: { url: e.target.value } })
                }
                placeholder="https://…"
              />
            </label>
            {form.cover_image.url && (
              <img
                className="cover-preview"
                src={form.cover_image.url}
                alt=""
              />
            )}
            <label>
              Source URL
              <input
                type="url"
                value={form.source_url}
                onChange={set("source_url")}
                placeholder="https://…"
              />
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}

function CategoryRow({ cat, others, onChange }) {
  const [name, setName] = useState(null);
  const [error, setError] = useState(null);
  const save = async () => {
    try {
      await api(`/categories/${cat.id}`, { method: "PUT", body: { name } });
      setName(null);
      onChange();
    } catch (error) {
      setError(error);
    }
  };
  const remove = async () => {
    let suffix = "";
    if (cat.count > 0) {
      const target = window.prompt(
        `Move ${cat.count} article(s) to a category slug:\n${others.map((c) => c.slug).join(", ")}`,
      );
      if (!target) return;
      const found = others.find((c) => c.slug === target.trim());
      if (!found) {
        setError(new Error("Choose an existing category slug"));
        return;
      }
      suffix = `?reassign_to=${found.id}`;
    } else if (!window.confirm(`Delete category "${cat.name}"?`)) return;
    try {
      await api(`/categories/${cat.id}${suffix}`, { method: "DELETE" });
      onChange();
    } catch (error) {
      setError(error);
    }
  };
  return (
    <tr>
      <td>
        {name !== null ? (
          <input
            aria-label="Category name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <>
            <strong>{cat.name}</strong>
            <span className="muted small"> /{cat.slug}</span>
          </>
        )}
      </td>
      <td className="num">{cat.count}</td>
      <td className="row-actions">
        {name !== null ? (
          <>
            <button onClick={save}>Save</button>
            <button onClick={() => setName(null)}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setName(cat.name)}>Edit</button>
            <button className="danger" onClick={remove}>
              Delete
            </button>
          </>
        )}
        <ErrorMessage error={error} />
      </td>
    </tr>
  );
}
export function Taxonomy() {
  const categories = useApi("/categories"),
    tags = useApi("/tags");
  const [newCat, setNewCat] = useState(""),
    [newTag, setNewTag] = useState(""),
    [tagFilter, setTagFilter] = useState(""),
    [error, setError] = useState(null);
  const run = async (fn, after) => {
    setError(null);
    try {
      await fn();
      after();
    } catch (error) {
      setError(error);
    }
  };
  const cats = categories.data?.items || [],
    tagItems = (tags.data?.items || []).filter((t) =>
      t.name.toLowerCase().includes(tagFilter.toLowerCase()),
    );
  return (
    <div>
      <h1 className="admin-title">Categories & tags</h1>
      <ErrorMessage error={error || categories.error || tags.error} />
      <div className="card">
        <h2>Categories</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Articles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  others={cats.filter((c) => c.id !== cat.id)}
                  onChange={categories.reload}
                />
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                api("/categories", { method: "POST", body: { name: newCat } }),
              () => {
                setNewCat("");
                categories.reload();
              },
            );
          }}
        >
          <input
            aria-label="New category"
            placeholder="New category name"
            maxLength={60}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            required
          />
          <button className="btn btn-primary">Add category</button>
        </form>
      </div>
      <div className="card">
        <h2>Tags ({tags.data?.items.length || 0})</h2>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api("/tags", { method: "POST", body: { name: newTag } }),
              () => {
                setNewTag("");
                tags.reload();
              },
            );
          }}
        >
          <input
            aria-label="New tag"
            placeholder="New tag"
            maxLength={40}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            required
          />
          <button className="btn btn-primary">Add tag</button>
          <input
            className="grow"
            aria-label="Filter tags"
            placeholder="Filter tags…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          />
        </form>
        <div className="tag-admin">
          {tagItems.map((t) => (
            <span key={t.id} className="tag tag-admin-item">
              {t.name} <span className="muted">({t.count})</span>
              <button
                title="Rename"
                onClick={() => {
                  const name = window.prompt("Rename tag", t.name);
                  if (name && name !== t.name)
                    run(
                      () =>
                        api(`/tags/${t.id}`, { method: "PUT", body: { name } }),
                      tags.reload,
                    );
                }}
              >
                ✎
              </button>
              <button
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete tag "${t.name}"?`))
                    run(
                      () => api(`/tags/${t.id}`, { method: "DELETE" }),
                      tags.reload,
                    );
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

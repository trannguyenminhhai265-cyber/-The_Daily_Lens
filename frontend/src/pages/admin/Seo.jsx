// Data & SEO Specialist screens: SEO metadata editor and analytics dashboard.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { ErrorMessage, Modal, Pagination, Spinner } from '../../components/common';
import { useApi } from '../../hooks';
import { compact } from '../../utils';

function SeoEditor({ doc, onClose, onSaved }) {
  const [form, setForm] = useState({
    meta_title: doc.seo.meta_title || '',
    meta_description: doc.seo.meta_description || '',
    keywords: (doc.seo.keywords || []).join(', '),
    canonical_url: doc.seo.canonical_url || '',
    cover_alt: doc.cover_image ? doc.cover_image.alt : '',
  });
  const [state, setState] = useState({ busy: false, error: null });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null });
    try {
      await api(`/manage/documents/${doc.id}/seo`, { method: 'PATCH', body: form });
      onSaved();
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const suggest = () =>
    setForm({
      ...form,
      meta_title: form.meta_title || doc.title.slice(0, 60),
      meta_description: form.meta_description || doc.summary.slice(0, 155),
      keywords: form.keywords || doc.tags.map((t) => t.name).join(', '),
      cover_alt: form.cover_alt || `Illustration for: ${doc.title}`,
    });

  const titleLen = form.meta_title.length;
  const descLen = form.meta_description.length;
  return (
    <Modal title="Edit SEO metadata" onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <ErrorMessage error={state.error} />
        <p className="small muted">{doc.title}</p>
        <label>
          Meta title <span className={`hint ${titleLen > 60 ? 'warn' : ''}`}>{titleLen}/60 recommended</span>
          <input value={form.meta_title} onChange={set('meta_title')} maxLength={70} />
        </label>
        <label>
          Meta description <span className={`hint ${descLen > 160 || (descLen && descLen < 70) ? 'warn' : ''}`}>{descLen}/160 recommended</span>
          <textarea rows={3} value={form.meta_description} onChange={set('meta_description')} maxLength={170} />
        </label>
        <label>
          Keywords <span className="hint">(comma separated)</span>
          <input value={form.keywords} onChange={set('keywords')} />
        </label>
        <label>
          Cover image alt text
          <input value={form.cover_alt} onChange={set('cover_alt')} maxLength={200} />
        </label>
        <label>
          Canonical URL <span className="hint">(optional)</span>
          <input value={form.canonical_url} onChange={set('canonical_url')} placeholder="https://…" />
        </label>
        <div className="serp-preview" aria-label="Search result preview">
          <div className="serp-url">{window.location.host}/article/{doc.slug}</div>
          <div className="serp-title">{form.meta_title || doc.title}</div>
          <div className="serp-desc">{form.meta_description || doc.summary}</div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={suggest}>Fill empty fields from content</button>
          <button className="btn btn-primary" disabled={state.busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function Check({ ok, label }) {
  return <span className={`seo-check ${ok ? 'ok' : 'missing'}`} title={label}>{ok ? '✓' : '✗'} {label}</span>;
}

export function SeoList() {
  const [filter, setFilter] = useState({ seo: 'missing', page: 1, q: '' });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const { data, loading, error, reload } = useApi('/manage/documents', { ...filter, status: 'published' });

  return (
    <div>
      <h1 className="admin-title">SEO metadata</h1>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, q, page: 1 });
        }}
      >
        <input className="grow" placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter.seo} onChange={(e) => setFilter({ ...filter, seo: e.target.value, page: 1 })}>
          <option value="missing">Missing SEO fields</option>
          <option value="">All published articles</option>
        </select>
        <button className="btn btn-ghost">Search</button>
      </form>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <p className="muted small">{data.total} article(s)</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Article</th><th>Checks</th><th className="num">Views</th><th /></tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <a href={`/article/${d.slug}`} target="_blank" rel="noreferrer"><strong>{d.title}</strong></a>
                        <div className="small muted">{d.seo.meta_description || 'No meta description'}</div>
                      </td>
                      <td className="checks">
                        <Check ok={!!d.seo.meta_title} label="Title" />
                        <Check ok={!!d.seo.meta_description} label="Description" />
                        <Check ok={d.seo.keywords && d.seo.keywords.length > 0} label="Keywords" />
                        <Check ok={!!(d.cover_image && d.cover_image.alt)} label="Alt text" />
                      </td>
                      <td className="num">{compact(d.views_count)}</td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => setEditing(d)}>Edit SEO</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(p) => setFilter({ ...filter, page: p })} />
          </>
        )
      )}
      {editing && (
        <SeoEditor
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Single-series column chart of daily views with a hover tooltip. */
function DailyViewsChart({ data }) {
  const [hover, setHover] = useState(null);
  const W = 720;
  const H = 220;
  const pad = { l: 36, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.views));
  const niceMax = Math.ceil(max / 10) * 10;
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax);
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Daily page views">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw;
          const h = Math.max(0, y(0) - y(d.views));
          const w = Math.max(1, bw - 2);
          const r = Math.min(4, w / 2, h);
          const top = y(d.views);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && (
                <path
                  className={`bar ${hover === i ? 'hover' : ''}`}
                  d={`M${x + 1},${y(0)} V${top + r} Q${x + 1},${top} ${x + 1 + r},${top} H${x + 1 + w - r} Q${x + 1 + w},${top} ${x + 1 + w},${top + r} V${y(0)} Z`}
                />
              )}
            </g>
          );
        })}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) =>
          data[i] ? (
            <text key={i} x={pad.l + i * bw + bw / 2} y={H - 6} className="axis" textAnchor="middle">
              {data[i].date.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%` }}>
          <strong>{data[hover].views}</strong> views
          <div className="muted">{data[hover].date}</div>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a single measure; values are labelled directly. */
function BarList({ rows, valueKey, labelKey, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r[labelKey]} title={`${r[labelKey]}: ${format(r[valueKey])}`}>
          <span className="barlist-label">{r[labelKey]}</span>
          <span className="barlist-track">
            <span className="barlist-fill" style={{ width: `${(r[valueKey] / max) * 100}%` }} />
          </span>
          <span className="barlist-value">{format(r[valueKey])}</span>
        </li>
      ))}
    </ul>
  );
}

export function Analytics() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useApi('/analytics/overview', { days });

  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Analytics</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="tiles">
              <div className="tile"><span className="tile-value">{compact(data.totals.views)}</span><span className="tile-label">Total views (all time)</span></div>
              <div className="tile"><span className="tile-value">{data.totals.published}</span><span className="tile-label">Published articles</span></div>
              <div className="tile"><span className="tile-value">{compact(data.totals.searches)}</span><span className="tile-label">Searches ({days}d)</span></div>
              <div className="tile"><span className="tile-value">{compact(data.totals.clicks)}</span><span className="tile-label">Result clicks ({days}d)</span></div>
              <div className="tile"><span className="tile-value">{data.totals.ctr}%</span><span className="tile-label">Search click-through rate</span></div>
              <div className="tile"><span className="tile-value">{compact(data.totals.comments)}</span><span className="tile-label">Visible comments</span></div>
            </div>

            <div className="card">
              <h2>Daily page views</h2>
              <DailyViewsChart data={data.daily_views} />
            </div>

            <div className="two-col">
              <div className="card">
                <h2>Views by category</h2>
                <BarList rows={data.by_category} labelKey="name" valueKey="views" format={compact} />
              </div>
              <div className="card">
                <h2>SEO health (published articles missing…)</h2>
                <BarList
                  rows={[
                    { name: 'Meta title', v: data.seo_missing.meta_title },
                    { name: 'Meta description', v: data.seo_missing.meta_description },
                    { name: 'Keywords', v: data.seo_missing.keywords },
                    { name: 'Image alt text', v: data.seo_missing.cover_alt },
                  ]}
                  labelKey="name"
                  valueKey="v"
                />
                <Link to="/admin/seo" className="small">Fix missing metadata →</Link>
              </div>
            </div>

            <div className="card">
              <h2>Top articles</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Article</th><th className="num">Views</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Rating</th></tr>
                  </thead>
                  <tbody>
                    {data.top_documents.map((d) => (
                      <tr key={d.id}>
                        <td><a href={`/article/${d.slug}`} target="_blank" rel="noreferrer">{d.title}</a></td>
                        <td className="num">{d.views_count.toLocaleString()}</td>
                        <td className="num">{d.likes_count}</td>
                        <td className="num">{d.comments_count}</td>
                        <td className="num">{d.rating_avg.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="two-col">
              <div className="card">
                <h2>Top search queries</h2>
                <table className="table">
                  <thead>
                    <tr><th>Query</th><th className="num">Searches</th><th className="num">Clicks</th><th className="num">CTR</th></tr>
                  </thead>
                  <tbody>
                    {data.top_queries.map((q) => (
                      <tr key={q.query}>
                        <td>{q.query}</td>
                        <td className="num">{q.searches}</td>
                        <td className="num">{q.clicks}</td>
                        <td className="num">{q.ctr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h2>Queries with no results</h2>
                {data.zero_result_queries.length === 0 ? (
                  <p className="muted">None in this period.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Query</th><th className="num">Times</th></tr>
                    </thead>
                    <tbody>
                      {data.zero_result_queries.map((q) => (
                        <tr key={q.query}><td>{q.query}</td><td className="num">{q.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="small muted">Content gaps: readers looked for these topics but found nothing.</p>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

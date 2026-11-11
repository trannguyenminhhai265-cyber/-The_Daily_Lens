import { useState } from "react";
import { ErrorMessage, Pagination, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { formatDateTime } from "../../utils";

export function SearchLogs() {
  const [filter, setFilter] = useState({
    event: "",
    q: "",
    source: "",
    page: 1,
  });
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi("/admin/search-logs", filter);
  return (
    <div>
      <h1 className="admin-title">Search & click logs</h1>
      <p className="muted small">
        Search events have no clicked document. Click events record the selected
        article and its position. Synthetic logs are demo data, not real user
        behavior.
      </p>
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, q, page: 1 });
        }}
      >
        <input
          className="grow"
          aria-label="Query filter"
          placeholder="Query contains…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Event"
          value={filter.event}
          onChange={(e) =>
            setFilter({ ...filter, event: e.target.value, page: 1 })
          }
        >
          <option value="">Searches & clicks</option>
          <option value="search">Searches</option>
          <option value="click">Clicks</option>
        </select>
        <select
          aria-label="Log source"
          value={filter.source}
          onChange={(e) =>
            setFilter({ ...filter, source: e.target.value, page: 1 })
          }
        >
          <option value="">All sources</option>
          <option value="real">Recorded</option>
          <option value="synthetic">Synthetic</option>
        </select>
        <button className="btn btn-ghost">Filter</button>
      </form>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event</th>
                    <th>Source</th>
                    <th>User</th>
                    <th>Query</th>
                    <th>Clicked article</th>
                    <th>Results / position</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="small nowrap">
                        {formatDateTime(l.timestamp)}
                      </td>
                      <td>{l.event}</td>
                      <td>
                        <span className="badge">
                          {l.is_synthetic ? "Synthetic" : "Recorded"}
                        </span>
                      </td>
                      <td className="small">
                        {typeof l.user_id === "object"
                          ? l.user_id?.username || "anonymous"
                          : l.user_id || "anonymous"}
                      </td>
                      <td>
                        <code>{l.query_string}</code>
                      </td>
                      <td className="small">
                        {l.clicked_doc_id &&
                        typeof l.clicked_doc_id === "object" ? (
                          <a
                            href={`/article/${l.clicked_doc_id.slug}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {l.clicked_doc_id.title}
                          </a>
                        ) : (
                          l.clicked_doc_id || "—"
                        )}
                      </td>
                      <td className="num">
                        {l.event === "click"
                          ? `#${l.position ?? "?"}`
                          : l.results_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              pages={data.pages}
              onChange={(page) => setFilter({ ...filter, page })}
            />
          </>
        )
      )}
    </div>
  );
}

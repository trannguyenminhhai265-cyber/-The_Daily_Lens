import { useState } from "react";
import { ErrorMessage, Pagination, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { formatDateTime } from "../../utils";

const EVENT_LABELS = { search: "Tìm kiếm", click: "Nhấp chuột" };
const ENGINE_LABELS = { keyword: "Từ khóa", vector: "Ngữ nghĩa" };
const TYPE_LABELS = { text: "Chữ", image: "Ảnh" };

export function SearchLogs() {
  const [filter, setFilter] = useState({
    event: "",
    q: "",
    source: "",
    engine: "",
    query_type: "",
    page: 1,
  });
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi("/admin/search-logs", filter);
  return (
    <div>
      <h1 className="admin-title">Nhật ký tìm kiếm & nhấp chuột</h1>
      <p className="muted small">
        Sự kiện tìm kiếm không có bài viết được nhấp. Sự kiện nhấp chuột ghi lại
        bài viết được chọn và vị trí của nó. Nhật ký giả lập chỉ là dữ liệu
        demo, không phản ánh hành vi người dùng thật.
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
          aria-label="Lọc theo từ khóa"
          placeholder="Từ khóa chứa…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Sự kiện"
          value={filter.event}
          onChange={(e) =>
            setFilter({ ...filter, event: e.target.value, page: 1 })
          }
        >
          <option value="">Tìm kiếm & nhấp chuột</option>
          <option value="search">Tìm kiếm</option>
          <option value="click">Nhấp chuột</option>
        </select>
        <select
          aria-label="Nguồn nhật ký"
          value={filter.source}
          onChange={(e) =>
            setFilter({ ...filter, source: e.target.value, page: 1 })
          }
        >
          <option value="">Tất cả nguồn</option>
          <option value="real">Thực tế</option>
          <option value="synthetic">Giả lập</option>
        </select>
        <select
          aria-label="Công cụ tìm kiếm"
          value={filter.engine}
          onChange={(e) =>
            setFilter({ ...filter, engine: e.target.value, page: 1 })
          }
        >
          <option value="">Mọi công cụ</option>
          <option value="keyword">Từ khóa</option>
          <option value="vector">Ngữ nghĩa</option>
        </select>
        <select
          aria-label="Loại truy vấn"
          value={filter.query_type}
          onChange={(e) =>
            setFilter({ ...filter, query_type: e.target.value, page: 1 })
          }
        >
          <option value="">Chữ & ảnh</option>
          <option value="text">Chữ</option>
          <option value="image">Ảnh</option>
        </select>
        <button className="btn btn-ghost">Lọc</button>
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
                    <th>Thời gian</th>
                    <th>Sự kiện</th>
                    <th>Nguồn</th>
                    <th>Người dùng</th>
                    <th>Công cụ</th>
                    <th>Loại</th>
                    <th>Từ khóa</th>
                    <th>Bài viết được nhấp</th>
                    <th>Kết quả / vị trí</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="small nowrap">
                        {formatDateTime(l.timestamp)}
                      </td>
                      <td>{EVENT_LABELS[l.event] || l.event}</td>
                      <td>
                        <span className="badge">
                          {l.is_synthetic ? "Giả lập" : "Thực tế"}
                        </span>
                      </td>
                      <td className="small">
                        {typeof l.user_id === "object"
                          ? l.user_id?.username || "ẩn danh"
                          : l.user_id || "ẩn danh"}
                      </td>
                      <td className="small">
                        {ENGINE_LABELS[l.engine] || l.engine || "—"}
                      </td>
                      <td className="small">
                        {TYPE_LABELS[l.query_type] || l.query_type || "—"}
                      </td>
                      <td>
                        {l.query_string ? (
                          <code>{l.query_string}</code>
                        ) : l.query_type === "image" ? (
                          <span className="muted small">(ảnh)</span>
                        ) : null}
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

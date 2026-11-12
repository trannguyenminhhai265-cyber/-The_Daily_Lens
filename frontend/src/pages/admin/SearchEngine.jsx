import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { indexDocument } from "../../api";
import { ErrorMessage, Spinner } from "../../components/common";
import { useApi } from "../../hooks";
import { compact, formatDateTime } from "../../utils";

const MAX_RETRIES = 4; // extra attempts after a 429
const BASE_WAIT_MS = 4000;

const ERROR_LABELS = {
  rate_limited: "Bị giới hạn tần suất (429)",
  unavailable: "Dịch vụ embedding không khả dụng (503)",
};

function sleep(ms, shouldStop) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (shouldStop() || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });
}

/** Index one document; on 429 wait and retry a few times. Returns { ok, error? }. */
async function indexWithRetry(id, shouldStop, onWait) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await indexDocument(id);
      return res && res.ok === false
        ? { ok: false, error: res.error || "unknown" }
        : { ok: true };
    } catch (err) {
      const code = err.message || "unknown";
      if (err.status === 429 && attempt < MAX_RETRIES && !shouldStop()) {
        const wait = BASE_WAIT_MS * 2 ** attempt;
        onWait(wait);
        await sleep(wait, shouldStop);
        if (shouldStop()) return { ok: false, error: code };
        continue;
      }
      return { ok: false, error: code };
    }
  }
}

export function SearchEngine() {
  const { data, loading, error, reload } = useApi("/admin/search-engine");
  const [run, setRun] = useState(null); // { done, total, title, failed, waiting, finished, stopped }
  const stopRef = useRef(false);
  const busy = Boolean(run && !run.finished);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopRef.current = true;
    };
  }, []);

  const docs = data ? data.documents || [] : [];
  const pendingDocs = docs.filter((d) => !d.processed);
  const attention = docs.filter(
    (d) => !d.processed || d.last_error || (d.has_image && !d.image_embedded),
  );

  const start = async (targets) => {
    if (busy || targets.length === 0) return;
    stopRef.current = false;
    const shouldStop = () => stopRef.current;
    const failed = [];
    const update = (patch) =>
      alive.current && setRun((r) => ({ ...(r || {}), ...patch }));
    update({
      done: 0,
      total: targets.length,
      title: "",
      failed: [],
      waiting: 0,
      stopping: false,
      finished: false,
      stopped: false,
    });
    let done = 0;
    for (const doc of targets) {
      if (shouldStop() || !alive.current) break;
      update({ title: doc.title, waiting: 0 });
      const res = await indexWithRetry(doc.id, shouldStop, (ms) =>
        update({ waiting: Math.round(ms / 1000) }),
      );
      if (!res.ok) failed.push({ id: doc.id, title: doc.title, error: res.error });
      done++;
      update({ done, failed: [...failed], waiting: 0 });
    }
    update({ finished: true, stopped: shouldStop() && done < targets.length });
    if (alive.current) reload();
  };

  return (
    <div>
      <div className="admin-head">
        <h1 className="admin-title">Công cụ tìm kiếm</h1>
      </div>
      <p className="muted small">
        Mỗi bài viết được tạo vector (embedding) để phục vụ tìm kiếm ngữ nghĩa.
        Bài được lưu trong trình soạn thảo sẽ tự động được index lại. Các nút
        dưới đây gọi từng bài một nên có thể mất vài phút.
      </p>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="tiles">
              <div className="tile">
                <span className="tile-value">{compact(data.total)}</span>
                <span className="tile-label">Tổng số bài</span>
              </div>
              <div className="tile">
                <span className="tile-value">{compact(data.indexed)}</span>
                <span className="tile-label">Đã index</span>
              </div>
              <div className="tile">
                <span className="tile-value">{compact(data.pending)}</span>
                <span className="tile-label">Chưa index</span>
              </div>
              <div className="tile">
                <span className="tile-value">
                  {compact(data.images_embedded)} / {compact(data.images_expected)}
                </span>
                <span className="tile-label">Ảnh đã embed / bài có ảnh</span>
              </div>
            </div>

            <div className="engine-actions">
              <button
                className="btn btn-primary"
                disabled={busy || pendingDocs.length === 0}
                onClick={() => start(pendingDocs)}
              >
                Index các bài chưa xử lý ({pendingDocs.length})
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy || docs.length === 0}
                onClick={() => {
                  if (
                    window.confirm(
                      `Index lại toàn bộ ${docs.length} bài? Việc này gọi API embedding cho từng bài và tốn hạn mức.`,
                    )
                  )
                    start(docs);
                }}
              >
                Index lại tất cả
              </button>
              {busy && (
                <button
                  className="btn btn-ghost"
                  disabled={run.stopping}
                  onClick={() => {
                    stopRef.current = true;
                    setRun((r) => ({ ...r, stopping: true }));
                  }}
                >
                  {run.stopping ? "Đang dừng…" : "Dừng"}
                </button>
              )}
              <button
                className="btn btn-ghost"
                disabled={busy || loading}
                onClick={reload}
              >
                Tải lại số liệu
              </button>
            </div>

            {run && (
              <div className="alert alert-info engine-progress" role="status">
                <div>
                  {run.finished
                    ? run.stopped
                      ? "Đã dừng. "
                      : "Hoàn tất. "
                    : "Đang index… "}
                  <strong>
                    {run.done}/{run.total}
                  </strong>
                  {run.failed.length > 0 && ` · ${run.failed.length} bài lỗi`}
                </div>
                <progress value={run.done} max={run.total || 1} />
                {!run.finished && run.title && (
                  <div className="small muted">
                    {run.waiting
                      ? `Bị giới hạn tần suất, chờ ${run.waiting} giây rồi thử lại: `
                      : "Đang xử lý: "}
                    {run.title}
                  </div>
                )}
                {run.failed.length > 0 && (
                  <ul className="small engine-failed">
                    {run.failed.slice(0, 10).map((f) => (
                      <li key={f.id}>
                        {f.title}: {ERROR_LABELS[f.error] || f.error}
                      </li>
                    ))}
                    {run.failed.length > 10 && (
                      <li>… và {run.failed.length - 10} bài khác</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            <h2 className="section-title">Bài cần chú ý ({attention.length})</h2>
            {attention.length === 0 ? (
              <p className="muted">
                Tất cả bài viết đã được index và không có lỗi.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Bài viết</th>
                      <th>Trạng thái</th>
                      <th>Ảnh</th>
                      <th>Lỗi gần nhất</th>
                      <th>Cập nhật</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {attention.slice(0, 200).map((d) => (
                      <tr key={d.id}>
                        <td>
                          <Link to={`/admin/articles/${d.id}`}>{d.title}</Link>
                        </td>
                        <td>
                          <span
                            className={`badge ${d.last_error ? "badge-error" : d.processed ? "badge-published" : "badge-pending"}`}
                          >
                            {d.last_error
                              ? "Lỗi"
                              : d.processed
                                ? "Đã index"
                                : "Chưa index"}
                          </span>
                        </td>
                        <td className="small">
                          {!d.has_image
                            ? "Không có ảnh"
                            : d.image_embedded
                              ? "Đã embed"
                              : "Chưa embed"}
                        </td>
                        <td className="small">
                          {d.last_error ? <code>{d.last_error}</code> : "—"}
                        </td>
                        <td className="small nowrap">
                          {formatDateTime(d.updated_at)}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => start([d])}
                          >
                            Chạy lại
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

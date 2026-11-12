import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, callApi } from "../api";
import ArticleCard from "../components/ArticleCard";
import { Empty, ErrorMessage, Pagination, Spinner } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks";
import { imageToPng } from "../imageUtils";
import { categoryLabel, setPageMeta } from "../utils";

/**
 * Search & directory page. Also serves /category/:slug and /tag/:slug.
 * Queries and result clicks are logged for the ranking engine implementation.
 */
export default function Search({ mode }) {
  const { slug } = useParams();
  const { settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const categories = useApi("/categories");
  const tags = useApi("/tags");

  const filters = {
    q: params.get("q") || "",
    category: mode === "category" ? slug : params.get("category") || "",
    tag: mode === "tag" ? slug : params.get("tag") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    sort: params.get("sort") || "latest",
    page: Number(params.get("page")) || 1,
  };
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [params.toString(), slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Image search: the picked file is previewed at once, then converted to PNG in the browser.
  const [image, setImage] = useState(null); // { previewUrl, name, data, mime, converting, error }
  const imageToken = useRef(0);
  const fileInput = useRef(null);
  const [tab, setTab] = useState("keyword"); // mobile only
  useEffect(
    () => () => {
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    },
    [image?.previewUrl],
  );
  const imageReady = Boolean(image && image.data);
  const imageMode = Boolean(image);
  const showVector = imageMode || Boolean(filters.q);

  const pickImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const token = ++imageToken.current;
    const previewUrl = URL.createObjectURL(file);
    setImage({ previewUrl, name: file.name, converting: true });
    setTab("vector");
    try {
      const png = await imageToPng(file, previewUrl);
      if (token === imageToken.current)
        setImage({ previewUrl, name: file.name, ...png });
    } catch (err) {
      if (token === imageToken.current)
        setImage({ previewUrl, name: file.name, error: err.message });
    }
  };
  const removeImage = () => {
    imageToken.current++;
    setImage(null);
    setTab("keyword");
  };

  // Keyword column (existing behaviour). Skipped entirely in image mode.
  const { data, loading, error } = useApi(
    imageMode ? null : "/documents",
    filters,
  );

  // Semantic column: POST /api/search, independent loading/error state.
  const [vec, setVec] = useState({ data: null, loading: false, error: null });
  const vecKey = JSON.stringify([
    showVector,
    filters.q,
    filters.category,
    filters.tag,
    filters.from,
    filters.to,
    imageReady ? image.previewUrl : null,
  ]);
  useEffect(() => {
    if (!showVector || (imageMode && !imageReady)) {
      setVec({ data: null, loading: false, error: null });
      return undefined;
    }
    const ctrl = new AbortController();
    const body = {};
    if (filters.q) body.q = filters.q;
    if (imageReady) body.image = { mime: image.mime, data: image.data };
    const f = {};
    for (const key of ["category", "tag", "from", "to"])
      if (filters[key]) f[key] = filters[key];
    if (Object.keys(f).length) body.filters = f;
    setVec({ data: null, loading: true, error: null });
    callApi("/api/search", body, { signal: ctrl.signal })
      .then((res) =>
        setVec({ data: res.documents || [], loading: false, error: null }),
      )
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setVec({ data: null, loading: false, error: err });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vecKey]);
  const vecMessage = (err) =>
    err.status === 413 || err.status === 400
      ? "Không thể tìm bằng ảnh hoặc từ khóa này. Hãy thử ảnh khác (PNG hoặc JPEG, nhỏ hơn)."
      : "Tìm kiếm ngữ nghĩa tạm không khả dụng";

  const category =
    categories.data &&
    categories.data.items.find((c) => c.slug === filters.category);
  const tag = tags.data && tags.data.items.find((t) => t.slug === filters.tag);
  const heading =
    mode === "category" && category
      ? categoryLabel(category)
      : mode === "tag" && tag
        ? `#${tag.name}`
        : "Tìm kiếm";

  useEffect(() => {
    setPageMeta(`${heading} | ${settings.site_name}`, undefined);
  }, [heading, settings.site_name, category]);

  const apply = (next) => {
    const merged = { ...draft, ...next };
    const out = {};
    for (const key of ["q", "from", "to", "sort", "page"]) {
      if (
        merged[key] &&
        !(key === "sort" && merged[key] === "latest") &&
        !(key === "page" && merged[key] === 1)
      ) {
        out[key] = String(merged[key]);
      }
    }
    if (mode !== "category" && merged.category) out.category = merged.category;
    if (mode !== "tag" && merged.tag) out.tag = merged.tag;
    setParams(out);
  };

  const logClick = (engine, doc, position) => () => {
    const queryType = engine === "vector" && imageMode ? "image" : "text";
    if (queryType === "text" && !filters.q) return;
    api("/search/click", {
      method: "POST",
      body: {
        query_string: queryType === "image" ? "" : filters.q,
        clicked_doc_id: doc.id,
        position,
        engine,
        query_type: queryType,
      },
    }).catch(() => {});
  };

  const clear = () => {
    setDraft({
      q: "",
      category: "",
      tag: "",
      from: "",
      to: "",
      sort: "latest",
      page: 1,
    });
    setParams({});
    removeImage();
  };

  const keywordColumn = (
    <>
      <ErrorMessage error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <Empty>
          Không có bài viết nào phù hợp. Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc.
        </Empty>
      ) : (
        data && (
          <>
            <p className="muted result-count">
              {data.total} kết quả
              {filters.q && (
                <>
                  {" "}
                  cho <strong>“{filters.q}”</strong>
                </>
              )}
            </p>
            <div className="list-results">
              {data.items.map((d, i) => (
                <ArticleCard
                  key={d.id}
                  doc={d}
                  variant="row"
                  onOpen={logClick(
                    "keyword",
                    d,
                    (filters.page - 1) * (data.limit || 10) + i + 1,
                  )}
                />
              ))}
            </div>
            <Pagination
              page={data.page}
              pages={data.pages}
              onChange={(p) => apply({ ...filters, page: p })}
            />
          </>
        )
      )}
    </>
  );

  const vectorColumn = vec.loading || (imageMode && image.converting) ? (
    <Spinner />
  ) : vec.error ? (
    <div className="alert alert-info">{vecMessage(vec.error)}</div>
  ) : imageMode && !imageReady ? (
    image.error ? null : <Spinner />
  ) : vec.data && vec.data.length === 0 ? (
    <Empty>Không tìm thấy bài viết nào gần nghĩa.</Empty>
  ) : (
    vec.data && (
      <>
        <p className="muted result-count">{vec.data.length} kết quả</p>
        <div className="list-results">
          {vec.data.map((d, i) => (
            <ArticleCard
              key={d.id}
              doc={d}
              variant="row"
              onOpen={logClick("vector", d, i + 1)}
            />
          ))}
        </div>
      </>
    )
  );

  return (
    <div className="container">
      <header className="page-header">
        <h1>{heading}</h1>
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
          placeholder="Từ khóa…"
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          aria-label="Từ khóa"
        />
        {mode !== "category" && (
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            aria-label="Chuyên mục"
          >
            <option value="">Tất cả chuyên mục</option>
            {(categories.data ? categories.data.items : []).map((c) => (
              <option key={c.id} value={c.slug}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        )}
        {mode !== "tag" && (
          <select
            value={draft.tag}
            onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
            aria-label="Thẻ"
          >
            <option value="">Tất cả thẻ</option>
            {(tags.data ? tags.data.items : [])
              .filter((t) => t.count > 0)
              .map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name} ({t.count})
                </option>
              ))}
          </select>
        )}
        <label className="inline-label">
          Từ ngày
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className="inline-label">
          Đến ngày
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <select
          value={draft.sort}
          onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
          aria-label="Sắp xếp"
        >
          <option value="latest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
          <option value="popular">Xem nhiều nhất</option>
        </select>
        <label className="btn btn-ghost file-btn">
          Tìm bằng ảnh
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={pickImage}
            hidden
          />
        </label>
        <button className="btn btn-primary">Áp dụng</button>
        <button type="button" className="btn btn-ghost" onClick={clear}>
          Đặt lại
        </button>
      </form>

      {image && (
        <div className="image-query">
          <img src={image.previewUrl} alt="Ảnh dùng để tìm kiếm" />
          <div className="image-query-info">
            <strong className="image-query-name">{image.name}</strong>
            <span className="muted small">
              {image.converting
                ? "Đang xử lý ảnh…"
                : image.error
                  ? image.error
                  : "Đang tìm các bài có ảnh hoặc nội dung gần giống ảnh này. Chỉ hiển thị kết quả ngữ nghĩa."}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={removeImage}>
            Bỏ ảnh
          </button>
        </div>
      )}

      {showVector ? (
        <>
          <div className="search-tabs" role="tablist">
            {!imageMode && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "keyword"}
                className={tab === "keyword" ? "active" : ""}
                onClick={() => setTab("keyword")}
              >
                Từ khóa
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === "vector" || imageMode}
              className={tab === "vector" || imageMode ? "active" : ""}
              onClick={() => setTab("vector")}
            >
              Ngữ nghĩa
            </button>
          </div>
          <div className={`search-columns${imageMode ? " single" : ""}`}>
            {!imageMode && (
              <section
                className={`search-col${tab === "keyword" ? " is-active" : ""}`}
              >
                <h2 className="col-title">Kết quả từ khóa</h2>
                {keywordColumn}
              </section>
            )}
            <section
              className={`search-col${tab === "vector" || imageMode ? " is-active" : ""}`}
            >
              <h2 className="col-title">Kết quả ngữ nghĩa</h2>
              {vectorColumn}
            </section>
          </div>
        </>
      ) : (
        keywordColumn
      )}
    </div>
  );
}

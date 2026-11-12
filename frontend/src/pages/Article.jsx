import DOMPurify from "dompurify";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { CategoryPill } from "../components/ArticleCard";
import { ErrorMessage, Spinner } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks";
import { compact, formatDate, setPageMeta } from "../utils";

export default function Article() {
  const { slug } = useParams();
  const { settings, isAdmin } = useAuth();
  const { data, loading, error } = useApi(`/documents/${slug}`);
  useEffect(() => {
    if (data)
      setPageMeta(
        `${data.document.title} | ${settings.site_name}`,
        data.document.summary,
      );
  }, [data, settings.site_name]);
  if (loading && !data) return <Spinner />;
  if (error)
    return (
      <div className="container narrow">
        <ErrorMessage error={error} />
        <Link to="/">← Về trang chủ</Link>
      </div>
    );
  if (!data) return null;
  const doc = data.document;
  return (
    <div className="container">
      <article className="article-page">
        <header className="article-header">
          <CategoryPill category={doc.category_id} />
          <h1>{doc.title}</h1>
          <p className="lede">{doc.summary}</p>
          <div className="byline">
            <div>
              <strong>{doc.author?.display_name || "Ban biên tập"}</strong>
              <div className="meta">
                <time dateTime={doc.created_at}>
                  {formatDate(doc.created_at, { dateStyle: "long" })}
                </time>
                <span>·</span>
                <span>{compact(doc.views_count)} lượt xem</span>
              </div>
            </div>
            {isAdmin && (
              <Link
                to={`/admin/articles/${doc.id}`}
                className="btn btn-ghost btn-sm byline-edit"
              >
                Chỉnh sửa
              </Link>
            )}
          </div>
        </header>
        {doc.cover_image?.url && (
          <figure className="cover">
            <img src={doc.cover_image.url} alt="" />
          </figure>
        )}
        <div className="article-layout">
          <div>
            <div
              className="prose"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(doc.content),
              }}
            />
            <div className="tag-row">
              {doc.tags.map((t) => (
                <Link key={t.id} to={`/tag/${t.slug}`} className="tag">
                  #{t.name}
                </Link>
              ))}
            </div>
            {doc.source_url && /^https?:\/\//i.test(doc.source_url) && (
              <p className="muted small">
                Nguồn:{" "}
                <a href={doc.source_url} target="_blank" rel="noreferrer">
                  Bài viết gốc
                </a>
              </p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

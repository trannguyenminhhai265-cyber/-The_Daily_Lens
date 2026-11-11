import { Link } from "react-router-dom";
import { compact, formatDate } from "../utils";

export function CategoryPill({ category }) {
  return category ? (
    <Link
      to={`/category/${category.slug}`}
      className="cat-pill"
      style={{ "--cat": "#b4232a" }}
    >
      {category.name}
    </Link>
  ) : null;
}

export default function ArticleCard({ doc, variant = "card", onOpen }) {
  const href = `/article/${doc.slug}`;
  if (variant === "mini")
    return (
      <Link to={href} className="mini-card" onClick={onOpen}>
        <span className="mini-title">{doc.title}</span>
        <span className="meta">
          {formatDate(doc.created_at)} · {compact(doc.views_count)} views
        </span>
      </Link>
    );
  return (
    <article className={`article-card article-${variant}`}>
      {doc.cover_image?.url && (
        <Link
          to={href}
          className="thumb"
          onClick={onOpen}
          tabIndex={-1}
          aria-hidden="true"
        >
          <img src={doc.cover_image.url} alt="" loading="lazy" />
        </Link>
      )}
      <div className="article-body">
        <CategoryPill category={doc.category_id} />
        <h3 className="article-title">
          <Link to={href} onClick={onOpen}>
            {doc.title}
          </Link>
        </h3>
        <p className="snippet">{doc.summary}</p>
        <div className="meta">
          <span>{doc.author?.display_name || "Staff"}</span>
          <span>·</span>
          <time dateTime={doc.created_at}>{formatDate(doc.created_at)}</time>
          <span className="meta-stats">{compact(doc.views_count)} views</span>
        </div>
      </div>
    </article>
  );
}

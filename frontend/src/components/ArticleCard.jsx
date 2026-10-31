import { Link } from 'react-router-dom';
import { compact, formatDate } from '../utils';

export function CategoryPill({ category }) {
  if (!category) return null;
  return (
    <Link to={`/category/${category.slug}`} className="cat-pill" style={{ '--cat': category.color }}>
      {category.name}
    </Link>
  );
}

/**
 * variant: "hero" | "card" | "row" | "mini"
 * onOpen: optional callback fired before navigating (used to log search clicks).
 */
export default function ArticleCard({ doc, variant = 'card', onOpen }) {
  const href = `/article/${doc.slug}`;
  const img = doc.cover_image && doc.cover_image.url;

  if (variant === 'mini') {
    return (
      <Link to={href} className="mini-card" onClick={onOpen}>
        <span className="mini-title">{doc.title}</span>
        <span className="meta">
          {formatDate(doc.published_at)} · {compact(doc.views_count)} views
        </span>
      </Link>
    );
  }

  return (
    <article className={`article-card article-${variant}`}>
      {img && (
        <Link to={href} className="thumb" onClick={onOpen} tabIndex={-1} aria-hidden="true">
          <img src={img} alt={doc.cover_image.alt || ''} loading="lazy" />
        </Link>
      )}
      <div className="article-body">
        <CategoryPill category={doc.category_id} />
        <h3 className="article-title">
          <Link to={href} onClick={onOpen}>
            {doc.title}
          </Link>
        </h3>
        {variant !== 'mini' && <p className="snippet">{doc.summary}</p>}
        <div className="meta">
          <span>{doc.author ? doc.author.display_name : 'Staff'}</span>
          <span>·</span>
          <time dateTime={doc.published_at}>{formatDate(doc.published_at)}</time>
          <span>·</span>
          <span>{doc.reading_time} min read</span>
          <span className="meta-stats">
            <span title="Views">👁 {compact(doc.views_count)}</span>
            <span title="Likes">♥ {compact(doc.likes_count)}</span>
            <span title="Comments">💬 {doc.comments_count}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

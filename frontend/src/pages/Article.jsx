import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import ArticleCard, { CategoryPill } from '../components/ArticleCard';
import CommentSection, { ReportDialog } from '../components/CommentSection';
import { Avatar, ErrorMessage, Spinner, StarRating } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { compact, formatDate, setPageMeta } from '../utils';

export default function Article() {
  const { slug } = useParams();
  const { user, settings, can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useApi(`/documents/${slug}`, null, [user && user.id]);
  const [engagement, setEngagement] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!data) return;
    const d = data.document;
    setEngagement({
      liked: data.viewer.liked,
      myRating: data.viewer.rating,
      likes: d.likes_count,
      ratingAvg: d.rating_avg,
      ratingCount: d.rating_count,
      comments: d.comments_count,
    });
    setPageMeta(`${d.seo.meta_title || d.title} | ${settings.site_name}`, d.seo.meta_description || d.summary);
  }, [data, settings.site_name]);

  if (loading && !data) return <Spinner />;
  if (error) {
    return (
      <div className="container narrow">
        <ErrorMessage error={error} />
        <Link to="/">← Back to home</Link>
      </div>
    );
  }
  if (!data || !engagement) return null;

  const doc = data.document;
  const requireLogin = () => {
    navigate('/login', { state: { from: `/article/${slug}` } });
  };

  const toggleLike = async () => {
    if (!user) return requireLogin();
    try {
      const r = await api(`/documents/${doc.id}/like`, { method: 'POST' });
      setEngagement((e) => ({ ...e, liked: r.liked, likes: r.likes_count }));
    } catch (err) {
      setActionError(err);
    }
  };

  const rate = async (value) => {
    if (!user) return requireLogin();
    try {
      const r = await api(`/documents/${doc.id}/rate`, { method: 'POST', body: { value } });
      setEngagement((e) => ({ ...e, myRating: r.rating, ratingAvg: r.rating_avg, ratingCount: r.rating_count }));
    } catch (err) {
      setActionError(err);
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: doc.title, url });
      else {
        await navigator.clipboard.writeText(url);
        window.alert('Link copied to clipboard');
      }
    } catch {
      // cancelled
    }
  };

  return (
    <div className="container">
      <article className="article-page">
        <header className="article-header">
          <CategoryPill category={doc.category_id} />
          <h1>{doc.title}</h1>
          <p className="lede">{doc.summary}</p>
          <div className="byline">
            <Avatar user={doc.author} size={44} />
            <div>
              <Link to={`/u/${doc.author.username}`} className="byline-name">{doc.author.display_name}</Link>
              <div className="meta">
                <time dateTime={doc.published_at}>{formatDate(doc.published_at, { dateStyle: 'long' })}</time>
                <span>·</span>
                <span>{doc.reading_time} min read</span>
                <span>·</span>
                <span>{compact(doc.views_count)} views</span>
              </div>
            </div>
            {can('content:manage') && (
              <Link to={`/admin/articles/${doc.id}`} className="btn btn-ghost btn-sm byline-edit">Edit</Link>
            )}
          </div>
        </header>

        {doc.cover_image && doc.cover_image.url && (
          <figure className="cover">
            <img src={doc.cover_image.url} alt={doc.cover_image.alt || ''} />
            {doc.cover_image.caption && <figcaption>{doc.cover_image.caption}</figcaption>}
          </figure>
        )}

        <div className="article-layout">
          <div>
            {/* Content is sanitized on the server before it is stored. */}
            <div className="prose" dangerouslySetInnerHTML={{ __html: doc.content }} />

            <div className="tag-row">
              {doc.tags.map((t) => (
                <Link key={t.id} to={`/tag/${t.slug}`} className="tag">#{t.name}</Link>
              ))}
            </div>

            <ErrorMessage error={actionError} />
            <div className="engagement-bar">
              <button className={`btn ${engagement.liked ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleLike} aria-pressed={engagement.liked}>
                ♥ {engagement.liked ? 'Liked' : 'Like'} · {engagement.likes}
              </button>
              <div className="rating-box">
                <StarRating value={engagement.myRating || engagement.ratingAvg} onRate={rate} label="Rate this article" />
                <span className="muted small">
                  {engagement.ratingAvg.toFixed(1)} / 5 ({engagement.ratingCount} ratings)
                  {engagement.myRating ? ` · your rating: ${engagement.myRating}` : ''}
                </span>
              </div>
              <button className="btn btn-ghost" onClick={share}>Share</button>
              {user && (
                <button className="btn btn-ghost" onClick={() => setReporting(true)}>Report</button>
              )}
            </div>

            <CommentSection documentId={doc.id} />
          </div>

          <aside className="sidebar">
            <div className="side-block">
              <h3 className="side-title">About the author</h3>
              <div className="author-box">
                <Avatar user={doc.author} size={56} />
                <div>
                  <Link to={`/u/${doc.author.username}`}><strong>{doc.author.display_name}</strong></Link>
                  <p className="muted small">{doc.author.bio}</p>
                </div>
              </div>
            </div>
            {data.related.length > 0 && (
              <div className="side-block">
                <h3 className="side-title">More in {doc.category_id.name}</h3>
                {data.related.map((d) => (
                  <ArticleCard key={d.id} doc={d} variant="mini" />
                ))}
              </div>
            )}
          </aside>
        </div>
      </article>
      {reporting && <ReportDialog targetType="document" targetId={doc.id} onClose={() => setReporting(false)} />}
    </div>
  );
}

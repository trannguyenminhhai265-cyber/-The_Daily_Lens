import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import ArticleCard from '../components/ArticleCard';
import { Avatar, Empty, ErrorMessage, MentionText, Spinner, StatusBadge, UserLink } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { ROLE_LABELS, formatDate, setPageMeta, timeAgo } from '../utils';

function ActivityList({ comments, emptyText, showAuthor }) {
  if (!comments.length) return <p className="muted">{emptyText}</p>;
  return (
    <ul className="activity">
      {comments.map((c) => (
        <li key={c.id}>
          <div className="small muted">
            {showAuthor && (
              <>
                <UserLink user={c.user_id} /> ·{' '}
              </>
            )}
            {timeAgo(c.created_at)} on{' '}
            {c.document_id ? <Link to={`/article/${c.document_id.slug}`}>{c.document_id.title}</Link> : 'a deleted article'}
            {c.status && c.status !== 'visible' && (
              <>
                {' '}
                <StatusBadge status={c.status} />
              </>
            )}
          </div>
          <p>
            <MentionText text={c.content} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export function UserProfile() {
  const { username } = useParams();
  const { settings } = useAuth();
  const { data, loading, error } = useApi(`/users/${username}`);

  useEffect(() => {
    if (data) setPageMeta(`${data.user.display_name} | ${settings.site_name}`);
  }, [data, settings.site_name]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="container narrow"><ErrorMessage error={error} /></div>;
  const { user, stats, comments, mentions, articles } = data;

  return (
    <div className="container narrow">
      <header className="profile-header">
        <Avatar user={user} size={88} />
        <div>
          <h1>{user.display_name}</h1>
          <div className="muted">
            @{user.username} · {ROLE_LABELS[user.role]} · joined {formatDate(user.created_at)}
          </div>
          {user.bio && <p>{user.bio}</p>}
          <div className="small muted">
            {stats.comments} comments · {stats.articles} articles
          </div>
        </div>
      </header>
      {articles.length > 0 && (
        <section>
          <h2 className="section-title">Articles</h2>
          <div className="list-results">
            {articles.map((d) => (
              <ArticleCard key={d.id} doc={d} variant="row" />
            ))}
          </div>
        </section>
      )}
      <div className="two-col">
        <section>
          <h2 className="section-title">Recent comments</h2>
          <ActivityList comments={comments} emptyText="No comments yet." />
        </section>
        <section>
          <h2 className="section-title">Tagged in</h2>
          <ActivityList comments={mentions} emptyText="Nobody has tagged this user yet." showAuthor />
        </section>
      </div>
    </div>
  );
}

export function MyProfile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    display_name: user.display_name,
    email: user.email,
    bio: user.bio || '',
    avatar_url: user.avatar_url || '',
  });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [profileState, setProfileState] = useState({ busy: false, error: null, ok: false });
  const [pwState, setPwState] = useState({ busy: false, error: null, ok: false });

  useEffect(() => setPageMeta('My profile'), []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileState({ busy: true, error: null, ok: false });
    try {
      const { user: updated } = await api('/auth/me', { method: 'PUT', body: form });
      setUser(updated);
      setProfileState({ busy: false, error: null, ok: true });
    } catch (error) {
      setProfileState({ busy: false, error, ok: false });
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) {
      setPwState({ busy: false, error: new Error('New passwords do not match'), ok: false });
      return;
    }
    setPwState({ busy: true, error: null, ok: false });
    try {
      await api('/auth/me/password', {
        method: 'PUT',
        body: { current_password: pw.current_password, new_password: pw.new_password },
      });
      setPw({ current_password: '', new_password: '', confirm: '' });
      setPwState({ busy: false, error: null, ok: true });
    } catch (error) {
      setPwState({ busy: false, error, ok: false });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="container narrow">
      <header className="profile-header">
        <Avatar user={{ ...user, ...form }} size={88} />
        <div>
          <h1>My profile</h1>
          <div className="muted">
            @{user.username} · {ROLE_LABELS[user.role]}
          </div>
          <Link to={`/u/${user.username}`} className="small">View public page →</Link>
        </div>
      </header>
      {user.is_muted && <div className="alert alert-info">Your account is currently muted: you cannot post comments.</div>}

      <div className="two-col">
        <form className="card form" onSubmit={saveProfile}>
          <h2>Profile details</h2>
          <ErrorMessage error={profileState.error} />
          {profileState.ok && <div className="alert alert-success">Profile saved.</div>}
          <label>
            Display name
            <input value={form.display_name} onChange={set('display_name')} maxLength={60} required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} required />
          </label>
          <label>
            Avatar image URL
            <input value={form.avatar_url} onChange={set('avatar_url')} placeholder="https://…" />
          </label>
          <label>
            Bio
            <textarea rows={4} value={form.bio} onChange={set('bio')} maxLength={500} />
          </label>
          <button className="btn btn-primary" disabled={profileState.busy}>Save profile</button>
        </form>

        <form className="card form" onSubmit={changePassword}>
          <h2>Change password</h2>
          <ErrorMessage error={pwState.error} />
          {pwState.ok && <div className="alert alert-success">Password updated.</div>}
          <label>
            Current password
            <input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
          </label>
          <label>
            New password
            <input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} minLength={8} required />
          </label>
          <label>
            Confirm new password
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          </label>
          <button className="btn btn-primary" disabled={pwState.busy}>Update password</button>
        </form>
      </div>
      <MyActivity username={user.username} />
    </div>
  );
}

function MyActivity({ username }) {
  const { data } = useApi(`/users/${username}`);
  if (!data) return null;
  return (
    <div className="two-col">
      <section>
        <h2 className="section-title">My comments</h2>
        <ActivityList comments={data.comments} emptyText="You have not commented yet." />
      </section>
      <section>
        <h2 className="section-title">Where I was tagged</h2>
        <ActivityList comments={data.mentions} emptyText="Nobody has tagged you yet." showAuthor />
      </section>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="container narrow">
      <Empty>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </Empty>
    </div>
  );
}

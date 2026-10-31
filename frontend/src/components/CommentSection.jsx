import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import { Avatar, ErrorMessage, MentionText, Modal, UserLink } from './common';

const REASONS = [
  ['spam', 'Spam'],
  ['abuse', 'Harassment or abuse'],
  ['offensive', 'Offensive content'],
  ['misinformation', 'Misinformation'],
  ['other', 'Other'],
];

export function ReportDialog({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [state, setState] = useState({ busy: false, error: null, done: false });

  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null, done: false });
    try {
      await api('/reports', { method: 'POST', body: { target_type: targetType, target_id: targetId, reason, details } });
      setState({ busy: false, error: null, done: true });
    } catch (error) {
      setState({ busy: false, error, done: false });
    }
  };

  return (
    <Modal title={`Report ${targetType === 'comment' ? 'comment' : 'article'}`} onClose={onClose}>
      {state.done ? (
        <>
          <p>Thanks — our moderators will review this report.</p>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      ) : (
        <form onSubmit={submit} className="form">
          <ErrorMessage error={state.error} />
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Details (optional)
            <textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={state.busy}>Submit report</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Textarea with @username autocomplete. */
function MentionTextarea({ value, onChange, placeholder, autoFocus }) {
  const ref = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(0);
  const [token, setToken] = useState(null); // { start, text }

  useEffect(() => {
    if (!token || token.text.length < 1) {
      setSuggestions([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const { items } = await api('/users/lookup', { params: { q: token.text } });
        setSuggestions(items);
        setActive(0);
      } catch {
        setSuggestions([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [token]);

  const handleChange = (e) => {
    const text = e.target.value;
    onChange(text);
    const caret = e.target.selectionStart;
    const m = text.slice(0, caret).match(/(^|\s)@([a-z0-9_]*)$/i);
    setToken(m ? { start: caret - m[2].length, text: m[2] } : null);
  };

  const choose = (user) => {
    const before = value.slice(0, token.start);
    const after = value.slice(token.start + token.text.length);
    const next = `${before}${user.username} ${after}`;
    onChange(next);
    setToken(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const pos = before.length + user.username.length + 1;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    }
  };

  return (
    <div className="mention-box">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={2000}
        autoFocus={autoFocus}
      />
      {suggestions.length > 0 && (
        <ul className="mention-list" role="listbox">
          {suggestions.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(u)}>
                <Avatar user={u} size={24} /> <strong>@{u.username}</strong> <span className="muted">{u.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentForm({ documentId, parentId, onCreated, onCancel, autoFocus }) {
  const [content, setContent] = useState('');
  const [state, setState] = useState({ busy: false, error: null, notice: null });

  const submit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setState({ busy: true, error: null, notice: null });
    try {
      const { comment } = await api(`/documents/${documentId}/comments`, {
        method: 'POST',
        body: { content, parent_id: parentId },
      });
      setContent('');
      setState({
        busy: false,
        error: null,
        notice: comment.status === 'visible' ? null : 'Your comment is awaiting moderation.',
      });
      onCreated(comment);
    } catch (error) {
      setState({ busy: false, error, notice: null });
    }
  };

  return (
    <form className="comment-form" onSubmit={submit}>
      <ErrorMessage error={state.error} />
      {state.notice && <div className="alert alert-info">{state.notice}</div>}
      <MentionTextarea
        value={content}
        onChange={setContent}
        autoFocus={autoFocus}
        placeholder={parentId ? 'Write a reply… (type @ to tag someone)' : 'Join the discussion… (type @ to tag someone)'}
      />
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        )}
        <button className="btn btn-primary btn-sm" disabled={state.busy || !content.trim()}>
          {parentId ? 'Reply' : 'Post comment'}
        </button>
      </div>
    </form>
  );
}

function CommentItem({ comment, replies, documentId, onChange }) {
  const { user, can } = useAuth();
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const author = comment.user_id;
  const isOwner = user && author && author.id === user.id;

  const remove = async () => {
    if (!window.confirm('Delete this comment?')) return;
    await api(`/comments/${comment.id}`, { method: 'DELETE' });
    onChange();
  };

  return (
    <li className="comment">
      <Avatar user={author} size={38} />
      <div className="comment-main">
        <div className="comment-head">
          <strong><UserLink user={author} /></strong>
          <span className="muted small">{timeAgo(comment.created_at)}</span>
          {comment.status === 'pending' && <span className="badge badge-pending">awaiting moderation</span>}
        </div>
        <p className="comment-text">
          <MentionText text={comment.content} />
        </p>
        <div className="comment-actions">
          {user && !comment.parent_id && <button onClick={() => setReplying((v) => !v)}>Reply</button>}
          {user && !isOwner && <button onClick={() => setReporting(true)}>Report</button>}
          {(isOwner || can('comments:moderate')) && <button onClick={remove}>Delete</button>}
        </div>
        {replying && (
          <CommentForm
            documentId={documentId}
            parentId={comment.id}
            autoFocus
            onCancel={() => setReplying(false)}
            onCreated={() => {
              setReplying(false);
              onChange();
            }}
          />
        )}
        {replies.length > 0 && (
          <ul className="comment-list replies">
            {replies.map((r) => (
              <CommentItem key={r.id} comment={r} replies={[]} documentId={documentId} onChange={onChange} />
            ))}
          </ul>
        )}
      </div>
      {reporting && <ReportDialog targetType="comment" targetId={comment.id} onClose={() => setReporting(false)} />}
    </li>
  );
}

export default function CommentSection({ documentId, onCountChange }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi(`/documents/${documentId}/comments`, null, [user && user.id]);
  const items = data ? data.items : [];
  const roots = items.filter((c) => !c.parent_id);
  const repliesOf = (id) => items.filter((c) => c.parent_id === id);

  useEffect(() => {
    if (data && onCountChange) onCountChange(items.filter((c) => c.status === 'visible').length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <section className="comments" id="comments">
      <h2 className="section-title">Comments ({items.length})</h2>
      {user ? (
        user.is_muted ? (
          <div className="alert alert-info">Your account has been muted by a moderator, so you cannot comment.</div>
        ) : (
          <CommentForm documentId={documentId} onCreated={reload} />
        )
      ) : (
        <div className="alert alert-info">
          <Link to="/login">Sign in</Link> or <Link to="/register">create an account</Link> to join the discussion.
        </div>
      )}
      <ErrorMessage error={error} />
      {loading && !data ? null : roots.length === 0 ? (
        <p className="muted">No comments yet. Be the first to share your thoughts.</p>
      ) : (
        <ul className="comment-list">
          {roots.map((c) => (
            <CommentItem key={c.id} comment={c} replies={repliesOf(c.id)} documentId={documentId} onChange={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

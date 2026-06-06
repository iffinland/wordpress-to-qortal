import { useEffect, useState } from 'react';
import { Edit3, MessageSquare, RefreshCcw, Send, X } from 'lucide-react';
import {
  canUsePublicComments,
  getCommentIdentity,
  loadPostComments,
  publishPostComment,
  type CommentIdentity,
  type PostComment
} from '../../comments/commentService';

function sameName(left = '', right = '') {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PostComments({ postId, enabled = true }: { postId: string; enabled?: boolean }) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [identity, setIdentity] = useState<CommentIdentity | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<PostComment | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const bridgeAvailable = canUsePublicComments();

  async function refresh() {
    if (!bridgeAvailable) return;
    setLoading(true);
    setError('');
    try {
      const [nextComments, nextIdentity] = await Promise.all([
        loadPostComments(postId),
        getCommentIdentity().catch(() => null)
      ]);
      setComments(nextComments);
      setIdentity(nextIdentity);
    } catch (loadError) {
      setError((loadError as Error).message || 'Unable to load comments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setComments([]);
    setDraft('');
    setEditing(null);
    void refresh();
  }, [postId, bridgeAvailable]);

  function beginEdit(comment: PostComment) {
    setEditing(comment);
    setDraft(comment.body_text);
    setError('');
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  async function submitComment() {
    if (!identity || !draft.trim()) return;
    setPublishing(true);
    setError('');
    try {
      const published = await publishPostComment({ postId, bodyText: draft, identity, existing: editing });
      setComments((current) => {
        const withoutCurrent = current.filter((comment) => comment.id !== published.id);
        return [...withoutCurrent, published].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
      });
      setDraft('');
      setEditing(null);
    } catch (publishError) {
      setError((publishError as Error).message || 'Unable to publish comment.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="post-comments" aria-labelledby="post-comments-title">
      <div className="post-comments-heading">
        <h2 id="post-comments-title"><MessageSquare size={21} /> Comments <span>{comments.length}</span></h2>
        {bridgeAvailable && <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCcw size={15} /> Refresh</button>}
      </div>

      {!enabled ? (
        <p className="comment-notice">Comments are disabled for this post.</p>
      ) : !bridgeAvailable ? (
        <p className="comment-notice">Open this article inside Qortal UI to read and publish QDN comments.</p>
      ) : (
        <>
          {loading && comments.length === 0 && <p className="comment-notice">Loading comments...</p>}
          {!loading && comments.length === 0 && <p className="comment-notice">No comments yet.</p>}
          <div className="comment-list">
            {comments.map((comment) => (
              <article className="public-comment" key={`${comment.qdn.name}:${comment.qdn.identifier}`}>
                <header>
                  <strong>{comment.author.name}</strong>
                  <time dateTime={comment.created_at}>{formatTimestamp(comment.created_at)}</time>
                  {comment.updated_at !== comment.created_at && <span>Edited {formatTimestamp(comment.updated_at)}</span>}
                </header>
                <p>{comment.body_text}</p>
                {identity && sameName(identity.name, comment.author.name) && (
                  <button type="button" onClick={() => beginEdit(comment)}><Edit3 size={14} /> Edit</button>
                )}
              </article>
            ))}
          </div>

          {identity ? (
            <div className="comment-composer">
              <div className="comment-composer-title">
                <strong>{editing ? 'Edit comment' : `Comment as ${identity.name}`}</strong>
                {editing && <button type="button" onClick={cancelEdit}><X size={14} /> Cancel</button>}
              </div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={5} placeholder="Write a comment..." />
              <button className="comment-submit" type="button" onClick={() => void submitComment()} disabled={publishing || !draft.trim()}>
                <Send size={16} /> {publishing ? 'Publishing...' : editing ? 'Save changes' : 'Publish comment'}
              </button>
            </div>
          ) : (
            <p className="comment-notice">A logged-in wallet with a registered Qortal name is required to comment.</p>
          )}
        </>
      )}

      {error && <p className="comment-error">{error}</p>}
    </section>
  );
}

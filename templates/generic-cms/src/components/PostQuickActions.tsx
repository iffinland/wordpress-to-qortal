import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CmsContentItem, CmsTemplateConfig } from '../types';
import { hasQortalBridge } from '../lib/qortal.js';
import { countPostLikes, newCommentIdentifier, postSocialTarget, publishPostSocial, readSocialPage, socialAccount } from '../lib/postSocial.js';

function Icon({ kind }: { kind: 'heart' | 'share' | 'comment' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    {kind === 'heart' ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /> : kind === 'comment' ? <path d="M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-4.8A9 9 0 1 1 21 11.5Z" /> : <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></>}
  </svg>;
}

export function PostQuickActions({ config, item, children }: { config: CmsTemplateConfig; item: CmsContentItem; children?: ReactNode }) {
  const [target, setTarget] = useState<{ key: string; url: string } | null>(null);
  const [likes, setLikes] = useState<number | null>(null);
  const [moreLikes, setMoreLikes] = useState(false);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [readError, setReadError] = useState('');
  const [likeError, setLikeError] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState('');
  const [author, setAuthor] = useState('');
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  const pendingComment = useRef('');
  const bridge = hasQortalBridge();
  useEffect(() => {
    active.current = true;
    postSocialTarget(config, item).then(async (value) => {
      if (!active.current) return;
      setTarget(value);
      if (bridge) {
        try { const result = await countPostLikes(value.key); if (active.current) { setLikes(result.count); setMoreLikes(result.hasMore); } }
        catch { if (active.current) setLikeError('Likes could not be loaded.'); }
      }
    }).catch((error) => { if (active.current) setNotice(error.message); });
    return () => { active.current = false; };
  }, []);

  async function loadComments(nextOffset = 0) {
    if (!target || loading) return;
    setLoading(true); setReadError('');
    try {
      const result = await readSocialPage('comment', target.key, nextOffset);
      if (!active.current) return;
      setComments((old) => {
        const map = new Map((nextOffset ? old : []).map((entry) => [entry.authorName + '/' + entry.identifier, entry]));
        result.entries.forEach((entry: any) => map.set(entry.authorName + '/' + entry.identifier, entry));
        return [...map.values()];
      });
      setOffset(result.nextOffset); setMore(result.hasMore);
    } catch (error) { if (active.current) setReadError(error instanceof Error ? error.message : 'Comments could not be loaded.'); }
    finally { if (active.current) setLoading(false); }
  }
  async function mutate(kind: 'like' | 'comment') {
    if (!target || busy) return;
    setBusy(true); setNotice('');
    try {
      const account = await socialAccount();
      if (!active.current) return;
      if (editing && author !== account.name) throw new Error('Reconnect the original comment author to edit this comment.');
      if (kind === 'comment' && !editing && !pendingComment.current) pendingComment.current = newCommentIdentifier(target.key);
      const entry = await publishPostSocial(kind, target.key, account, { text, identifier: kind === 'comment' ? editing || pendingComment.current : '' });
      if (!active.current) return;
      setAuthor(account.name);
      if (kind === 'like') { setLiked(true); setNotice('Like submitted to QDN. The public count updates after propagation.'); }
      else { setComments((old) => [entry, ...old.filter((value) => value.authorName !== entry.authorName || value.identifier !== entry.identifier)]); setText(''); setEditing(''); pendingComment.current = ''; setNotice('Comment submitted to QDN. Other readers will see it after propagation.'); }
    } catch (error) { if (active.current) setNotice(error instanceof Error ? error.message : 'The action failed.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="post-social" aria-label="Post quick actions">
    <div className="post-social__bar" role="group" aria-label="Post actions">
      <button type="button" title="Like" aria-label="Like post" aria-pressed={liked} disabled={!bridge || !target || busy || liked} onClick={() => mutate('like')}><Icon kind="heart"/><span>{likes === null ? 'Like' : `${likes}${moreLikes ? '+' : ''}`}</span></button>
      <button type="button" title="Share" aria-label="Share post" disabled={!target} onClick={async () => {
        if (!target) return;
        try { await navigator.clipboard.writeText(target.url); setNotice('Post link copied.'); }
        catch { setNotice('Copy this post link: ' + target.url); }
      }}><Icon kind="share"/><span className="visually-hidden">Share</span></button>
      <button type="button" title="Comments" aria-label="Comments" aria-expanded={expanded} disabled={!target} onClick={() => { setExpanded(true); if (!expanded && bridge) void loadComments(); requestAnimationFrame(() => { panel.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); panel.current?.focus(); }); }}><Icon kind="comment"/><span className="visually-hidden">Comments</span></button>
    </div>
    {notice && <p role="status" className="post-social__notice">{notice}</p>}
    {likeError && <p role="alert">{likeError} <button type="button" onClick={async () => {
      if (!target) return;
      try { const result = await countPostLikes(target.key); if (active.current) { setLikes(result.count); setMoreLikes(result.hasMore); setLikeError(''); } }
      catch { /* Keep the retry available. */ }
    }}>Retry likes</button></p>}
    {children}
    {!bridge && <p className="muted">Open this post in Qortal Hub to like it or read and publish comments.</p>}
    {readError && <p role="alert">{readError} <button type="button" disabled={!bridge || loading} onClick={() => loadComments(offset)}>Retry comments</button></p>}
    {expanded && <section ref={panel} tabIndex={-1} className="post-social__comments" aria-label="Post comments">
      <h2>Comments</h2>
      {loading && <p role="status">Loading comments…</p>}
      {bridge && !loading && !readError && !comments.length && <p>No comments found.</p>}
      <ol>{comments.map((entry) => <li key={entry.authorName + '/' + entry.identifier}><strong>{entry.authorName}</strong><p className="post-social__text">{entry.text}</p>{author === entry.authorName && <button type="button" disabled={busy} onClick={() => { setEditing(entry.identifier); setText(entry.text); input.current?.focus(); }}>Edit comment</button>}</li>)}</ol>
      {bridge && !readError && more && <button type="button" disabled={loading} onClick={() => loadComments(offset)}>Load more comments</button>}
      {bridge && !author && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const account = await socialAccount(); if (active.current) setAuthor(account.name); }
        catch (error) { if (active.current) setNotice(error instanceof Error ? error.message : 'Could not connect.'); }
        finally { if (active.current) setBusy(false); }
      }}>Connect to edit your comments</button>}
      {bridge && <form onSubmit={(event) => { event.preventDefault(); void mutate('comment'); }}>
        <label htmlFor="post-comment">{editing ? 'Edit your comment' : 'Your comment'}</label>
        <textarea id="post-comment" ref={input} value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={4} disabled={busy}/>
        <p className="muted">Comments and likes are public QDN publications under your Qortal name. Qortal Hub asks for confirmation and any applicable fee.</p>
        <button type="submit" className="button" disabled={busy || !target || !text.trim()}>{busy ? 'Submitting…' : editing ? 'Save comment' : 'Publish comment'}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setText(''); }}>Cancel edit</button>}
      </form>}
    </section>}
  </section>;
}

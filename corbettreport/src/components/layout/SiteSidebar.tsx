import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { archiveHref, postHref } from '../../app/routes';
import { canUsePublicComments, loadRecentPostComments, type PostComment } from '../../comments/commentService';
import { createArchiveMonths } from '../../data/archive';
import { loadRecentPostTips, type PostTipEvent } from '../../social/postEngagementService';
import libertasImage from '../../assets/sidebar/libertas-160-x-600.png';
import type { ContentPost } from '../../types/content';
import { copyText } from '../../utils/clipboard';

const LIBERTAS_LINK = 'https://libertas.earth/';
const LIBERTAS_IMAGE = libertasImage;

function truncate(value: string, length = 92) {
  return value.length > length ? `${value.slice(0, length - 1).trim()}...` : value;
}

function formatSmallDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

export function SiteSidebar({ posts }: { posts: ContentPost[] }) {
  const [recentComments, setRecentComments] = useState<PostComment[]>([]);
  const [recentTips, setRecentTips] = useState<PostTipEvent[]>([]);
  const [copyNotice, setCopyNotice] = useState<{ message: string; success: boolean } | null>(null);
  const archiveMonths = useMemo(() => createArchiveMonths(posts), [posts]);
  const postsById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const bridgeAvailable = canUsePublicComments();

  useEffect(() => {
    if (!copyNotice) return;
    const timeout = window.setTimeout(() => setCopyNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  useEffect(() => {
    let cancelled = false;
    if (!bridgeAvailable) {
      setRecentComments([]);
      setRecentTips([]);
      return;
    }

    void Promise.all([
      loadRecentPostComments(5).catch(() => []),
      loadRecentPostTips(12).catch(() => [])
    ]).then(([comments, tips]) => {
      if (cancelled) return;
      setRecentComments(comments);
      const uniqueTips = new Map<string, PostTipEvent>();
      for (const tip of tips) {
        if (!uniqueTips.has(tip.post_id)) uniqueTips.set(tip.post_id, tip);
        if (uniqueTips.size >= 5) break;
      }
      setRecentTips([...uniqueTips.values()]);
    });

    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable]);

  async function copyLibertasLink(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const copied = await copyText(LIBERTAS_LINK);
    setCopyNotice({
      success: copied,
      message: copied ? 'Libertas link copied to clipboard.' : 'Unable to copy Libertas link.'
    });
  }

  function changeArchiveMonth(value: string) {
    if (!value) return;
    const [year, month] = value.split('-').map((part) => Number.parseInt(part, 10));
    window.location.hash = archiveHref(year, month).slice(1);
  }

  return (
    <aside className="site-sidebar" aria-label="Sidebar">
      {copyNotice && <p className={`copy-status ${copyNotice.success ? 'success' : 'error'}`} role="status">{copyNotice.message}</p>}

      <section className="sidebar-widget sidebar-ad">
        <a href={LIBERTAS_LINK} onClick={(event) => void copyLibertasLink(event)} title="Click to copy libertas.earth link">
          <img src={LIBERTAS_IMAGE} alt="Visit libertas.earth to watch an important video about freedom" loading="lazy" />
        </a>
      </section>

      <section className="sidebar-widget">
        <h2>Recent Comments</h2>
        {!bridgeAvailable ? (
          <p className="sidebar-muted">Open inside Qortal UI to load QDN comments.</p>
        ) : recentComments.length === 0 ? (
          <p className="sidebar-muted">No comments yet.</p>
        ) : (
          <ol className="sidebar-list">
            {recentComments.map((comment) => {
              const post = postsById.get(comment.post_id);
              return (
                <li key={`${comment.qdn.name}:${comment.qdn.identifier}`}>
                  <strong>{comment.author.name}</strong>
                  <span> on </span>
                  <a href={post ? postHref(post.slug) : '#/archive'}>{post ? post.title : comment.post_id}</a>
                  <p>{truncate(comment.body_text)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="sidebar-widget">
        <h2>Last Tipped Posts</h2>
        {!bridgeAvailable ? (
          <p className="sidebar-muted">Open inside Qortal UI to load tip activity.</p>
        ) : recentTips.length === 0 ? (
          <p className="sidebar-muted">No tips recorded yet.</p>
        ) : (
          <ol className="sidebar-list">
            {recentTips.map((tip) => (
              <li key={`${tip.qdn.name}:${tip.qdn.identifier}`}>
                <a href={postHref(tip.post_slug)}>{tip.post_title}</a>
                <p>{tip.amount_qort} QORT on {formatSmallDate(tip.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="sidebar-widget">
        <h2>Archive</h2>
        <select className="sidebar-archive-select" defaultValue="" onChange={(event) => changeArchiveMonth(event.target.value)}>
          <option value="" disabled>Select month</option>
          {archiveMonths.map((item) => (
            <option key={item.key} value={item.key}>{item.label} ({item.count})</option>
          ))}
        </select>
      </section>
    </aside>
  );
}

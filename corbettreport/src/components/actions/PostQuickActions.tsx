import { useEffect, useMemo, useState } from 'react';
import { Coins, Heart, MessageSquare, Send, Share2, X } from 'lucide-react';
import { postHref } from '../../app/routes';
import { canUsePublicComments, getCommentIdentity, loadPostComments, type CommentIdentity } from '../../comments/commentService';
import {
  fetchPostLikeCount,
  fetchQortBalance,
  hasPostLike,
  publishPostLike,
  publishPostTipEvent,
  resolveNameAddress,
  sendQortTip
} from '../../social/postEngagementService';
import type { ContentPost } from '../../types/content';
import { copyText } from '../../utils/clipboard';

function buildPostShareLink(post: ContentPost) {
  const hash = postHref(post.slug);
  try {
    const url = new URL(window.location.href);
    url.hash = hash.replace(/^#/, '');
    return url.toString();
  } catch {
    return hash;
  }
}

function formatBalance(value: number | null) {
  if (typeof value !== 'number') return 'Unknown';
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function PostQuickActions({ post, commentCount }: { post: ContentPost; commentCount?: number | null }) {
  const [identity, setIdentity] = useState<CommentIdentity | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [localCommentCount, setLocalCommentCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [notice, setNotice] = useState<{ message: string; success: boolean } | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [tipRecipient, setTipRecipient] = useState('');
  const [tipBalance, setTipBalance] = useState<number | null>(null);
  const [tipLoading, setTipLoading] = useState(false);
  const [tipSending, setTipSending] = useState(false);
  const [tipError, setTipError] = useState('');
  const bridgeAvailable = canUsePublicComments();
  const displayedCommentCount = typeof commentCount === 'number' ? commentCount : localCommentCount;
  const shareLink = useMemo(() => buildPostShareLink(post), [post.slug]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    setLikeCount(0);
    setLocalCommentCount(0);
    setLiked(false);
    setIdentity(null);

    async function loadEngagement() {
      if (!bridgeAvailable) return;

      try {
        const [nextLikes, nextComments, nextIdentity] = await Promise.all([
          fetchPostLikeCount(post.id).catch(() => 0),
          typeof commentCount === 'number' || post.commentsEnabled === false ? Promise.resolve([]) : loadPostComments(post.id).catch(() => []),
          getCommentIdentity().catch(() => null)
        ]);
        if (cancelled) return;
        setLikeCount(nextLikes);
        if (typeof commentCount !== 'number') setLocalCommentCount(nextComments.length);
        setIdentity(nextIdentity);

        if (nextIdentity) {
          const nextLiked = await hasPostLike(post.id, nextIdentity).catch(() => false);
          if (!cancelled) setLiked(nextLiked);
        }
      } catch {
        if (!cancelled) {
          setLikeCount(0);
          setLocalCommentCount(0);
        }
      }
    }

    void loadEngagement();
    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable, commentCount, post.commentsEnabled, post.id]);

  async function likePost() {
    if (!bridgeAvailable) {
      setNotice({ success: false, message: 'Open this app inside Qortal UI to like posts.' });
      return;
    }
    if (!identity) {
      setNotice({ success: false, message: 'A registered Qortal name is required to like posts.' });
      return;
    }
    if (liked) {
      setNotice({ success: true, message: 'You already liked this post.' });
      return;
    }

    setIsLiking(true);
    try {
      await publishPostLike({ postId: post.id, postTitle: post.title, identity });
      setLiked(true);
      setLikeCount((current) => current + 1);
      setNotice({ success: true, message: 'Post liked.' });
    } catch (error) {
      setNotice({ success: false, message: (error as Error).message || 'Unable to like post.' });
    } finally {
      setIsLiking(false);
    }
  }

  async function sharePost() {
    const copied = await copyText(shareLink);
    setNotice({
      success: copied,
      message: copied ? 'Post link copied to clipboard.' : 'Unable to copy post link.'
    });
  }

  async function openTipModal() {
    setTipOpen(true);
    setTipAmount('');
    setTipError('');
    setTipRecipient('');
    setTipBalance(null);
    setTipLoading(true);

    if (!bridgeAvailable) {
      setTipLoading(false);
      setTipError('Open this app inside Qortal UI to send QORT tips.');
      return;
    }

    try {
      const [balance, recipient] = await Promise.all([
        fetchQortBalance().catch(() => null),
        resolveNameAddress(post.author).catch(() => '')
      ]);
      setTipBalance(balance);
      setTipRecipient(recipient);
      if (!recipient) setTipError(`Unable to resolve Qortal name ${post.author}.`);
    } finally {
      setTipLoading(false);
    }
  }

  async function sendTip() {
    const amount = Number(tipAmount);
    if (!tipRecipient) {
      setTipError('Recipient wallet address is unavailable.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setTipError('Enter a QORT amount greater than 0.');
      return;
    }
    if (typeof tipBalance === 'number' && amount > tipBalance) {
      setTipError('Entered amount is higher than your wallet balance.');
      return;
    }

    setTipSending(true);
    setTipError('');
    try {
      await sendQortTip({ recipient: tipRecipient, amount });
      const tipSender = identity || await getCommentIdentity().catch(() => null);
      if (tipSender) {
        await publishPostTipEvent({
          postId: post.id,
          postSlug: post.slug,
          postTitle: post.title,
          amount,
          recipientName: post.author,
          recipientAddress: tipRecipient,
          sender: tipSender
        }).catch(() => null);
      }
      setTipOpen(false);
      setTipAmount('');
      setNotice({ success: true, message: 'Tip sent.' });
    } catch (error) {
      setTipError((error as Error).message || 'Tip transfer failed.');
    } finally {
      setTipSending(false);
    }
  }

  return (
    <>
      <section className="post-quick-action-panel" aria-label="Post quick actions">
        <button className={liked ? 'is-active' : ''} type="button" onClick={() => void likePost()} disabled={isLiking} title="Like post">
          <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          <span>Like</span>
          <strong>{likeCount}</strong>
        </button>
        <button type="button" onClick={() => void sharePost()} title="Share post link">
          <Share2 size={17} />
          <span>Share post Link</span>
        </button>
        <button type="button" onClick={() => void openTipModal()} title="Send QORT tip">
          <Coins size={17} />
          <span>Send Tips</span>
        </button>
        <span className="post-quick-action-count" title="Comments">
          <MessageSquare size={17} />
          <span>Comments</span>
          <strong>{displayedCommentCount}</strong>
        </span>
      </section>

      {notice && <p className={`copy-status ${notice.success ? 'success' : 'error'}`} role="status">{notice.message}</p>}

      {tipOpen && (
        <div className="quick-action-modal-backdrop" role="presentation">
          <section className="quick-action-modal" role="dialog" aria-modal="true" aria-labelledby="quick-tip-title">
            <header>
              <h2 id="quick-tip-title">Send QORT tip</h2>
              <button type="button" onClick={() => setTipOpen(false)} aria-label="Close tip modal"><X size={18} /></button>
            </header>
            <p>Recipient: <strong>{post.author}</strong></p>
            <p>Wallet balance: <strong>{formatBalance(tipBalance)} QORT</strong></p>
            <label>
              Amount
              <input
                value={tipAmount}
                onChange={(event) => setTipAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                disabled={tipLoading || tipSending}
              />
            </label>
            {tipError && <p className="quick-action-error">{tipError}</p>}
            <div className="quick-action-modal-actions">
              <button type="button" onClick={() => setTipOpen(false)} disabled={tipSending}>Cancel</button>
              <button type="button" onClick={() => void sendTip()} disabled={tipLoading || tipSending || !tipAmount.trim()}>
                <Send size={16} /> {tipSending ? 'Sending...' : tipLoading ? 'Loading...' : 'Send tip'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

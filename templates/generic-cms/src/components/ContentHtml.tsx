import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { sanitizeHtml } from '../lib/sanitize.js';
import { copyText } from '../lib/clipboard.js';
import { openQortalLink } from '../lib/qortal.js';
import { parseQortalLink } from '../lib/links.js';
import { highlightTextParts, normalizeSearchText } from '../lib/search.js';

const COPY_TITLE = 'Copy this link to the clipboard';
const QORTAL_TITLE = 'Open this link in Qortal Hub';
const SUCCESS_BADGE_MS = 2200;
const ERROR_BADGE_MS = 4200;

function prepareContentLinks(html: string) {
  const document = new DOMParser().parseFromString(html || '', 'text/html');

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = link.getAttribute('href') || '';
    if (!href) continue;

    if (href.startsWith('#/')) {
      link.setAttribute('data-internal-link', 'true');
      continue;
    }

    if (parseQortalLink(href)) {
      link.setAttribute('data-qortal-link', href);
      link.setAttribute('title', QORTAL_TITLE);
      link.setAttribute('rel', 'noopener noreferrer');
      continue;
    }

    if (/^https?:\/\//i.test(href)) {
      link.setAttribute('data-copy-web2-url', href);
      link.setAttribute('title', COPY_TITLE);
      link.removeAttribute('target');
    }
  }

  return document.body.innerHTML;
}

type Badge = {
  id: number;
  message: string;
  success: boolean;
  x: number;
  y: number;
};

/**
 * Client-side highlight of search terms in rendered article text. It walks
 * text nodes and wraps matches in <mark>; it never injects HTML from a query.
 */
function useSearchHighlights(rootRef: React.RefObject<HTMLDivElement | null>, terms: string[]) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const mark of Array.from(root.querySelectorAll('mark.qms-search-hit'))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
    const tokens = [...new Set(terms.map((term) => normalizeSearchText(term)).filter((term) => term.length >= 2))];
    if (tokens.length === 0) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'MARK', 'TEXTAREA'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    for (const node of nodes) {
      const value = node.nodeValue || '';
      const lower = normalizeSearchText(value);
      let index = 0;
      let found = -1;
      for (const token of tokens) {
        const at = lower.indexOf(token, index);
        if (at >= 0 && (found < 0 || at < found)) found = at;
      }
      if (found < 0) continue;
      const parts = highlightTextParts(value, tokens);
      if (!parts.some((part) => part.match)) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.match) {
          const mark = document.createElement('mark');
          mark.className = 'qms-search-hit';
          mark.textContent = part.text;
          fragment.appendChild(mark);
        } else {
          fragment.appendChild(document.createTextNode(part.text));
        }
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }, [rootRef, terms.join('\u0000')]);
}

export function ContentHtml(props: { html: string; className?: string; highlightTerms?: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const clean = useMemo(() => sanitizeHtml(props.html || ''), [props.html]);
  const preparedHtml = useMemo(() => prepareContentLinks(clean), [clean]);
  const [badge, setBadge] = useState<Badge | null>(null);
  useSearchHighlights(ref, props.highlightTerms || []);

  useEffect(() => {
    if (!badge) return;
    const timeout = window.setTimeout(() => setBadge(null), badge.success ? SUCCESS_BADGE_MS : ERROR_BADGE_MS);
    return () => window.clearTimeout(timeout);
  }, [badge]);

  function showBadge(link: HTMLAnchorElement, message: string, success: boolean) {
    let x = 16;
    let y = 16;
    try {
      const rect = link.getBoundingClientRect();
      x = Math.max(8, Math.min(rect.right + 8, (window.innerWidth || 1024) - 210));
      y = Math.max(8, rect.top);
    } catch {
      // Keep the fallback position.
    }
    setBadge({ id: Date.now(), message, success, x, y });
  }

  async function activate(link: HTMLAnchorElement, event: MouseEvent | KeyboardEvent) {
    const qortalHref = link.dataset.qortalLink;
    if (qortalHref) {
      event.preventDefault();
      const result = await openQortalLink(qortalHref);
      if (result.ok) return;
      const copied = await copyText(qortalHref);
      showBadge(
        link,
        (copied ? 'Link copied. ' : '') + result.message + ' ' + qortalHref,
        false
      );
      return;
    }

    const copyUrl = link.dataset.copyWeb2Url;
    if (copyUrl) {
      event.preventDefault();
      const copied = await copyText(copyUrl);
      showBadge(link, copied ? 'Link copied.' : 'Could not copy the link. Copy it manually: ' + copyUrl, copied);
      return;
    }

    if (link.dataset.internalLink === 'true') {
      // Native anchors already update the hash; keep modifier clicks intact.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.location.hash = (link.getAttribute('href') || '').slice(1);
    }
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    void activate(link, event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#/') && !link.dataset.qortalLink && !link.dataset.copyWeb2Url) return;
    event.preventDefault();
    void activate(link, event);
  }

  return (
    <>
      <div
        ref={ref}
        className={'content-html' + (props.className ? ' ' + props.className : '')}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        dangerouslySetInnerHTML={{ __html: preparedHtml }}
      />
      {badge ? (
        <span
          key={badge.id}
          className={'link-badge ' + (badge.success ? 'link-badge--success' : 'link-badge--error')}
          style={{ position: 'fixed', left: badge.x, top: badge.y }}
          role={badge.success ? 'status' : 'alert'}
          aria-live={badge.success ? 'polite' : 'assertive'}
        >
          {badge.message}
        </span>
      ) : null}
    </>
  );
}

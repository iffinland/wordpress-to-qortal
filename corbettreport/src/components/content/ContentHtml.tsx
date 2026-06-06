import { useEffect, useMemo, useState } from 'react';
import { internalRouteForWeb2Url } from '../../app/routes';
import { copyText } from '../../utils/clipboard';

const COPY_TOOLTIP = 'Click this link to copy it to the clipboard';

function prepareContentLinks(html: string) {
  const document = new DOMParser().parseFromString(html || '', 'text/html');

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = link.getAttribute('href') || '';
    if (!href) continue;

    if (href.startsWith('#/')) {
      link.setAttribute('data-qortal-internal-link', 'true');
      link.setAttribute('title', 'Open this page inside The Corbett Report');
      continue;
    }

    const internalRoute = internalRouteForWeb2Url(href);
    if (internalRoute) {
      link.setAttribute('data-web2-href', href);
      link.setAttribute('data-qortal-internal-link', 'true');
      link.setAttribute('href', internalRoute);
      link.setAttribute('title', 'Open this page inside The Corbett Report');
      link.removeAttribute('target');
      continue;
    }

    if (/^https?:\/\//i.test(href)) {
      link.setAttribute('data-copy-web2-url', href);
      link.setAttribute('data-copy-tooltip', COPY_TOOLTIP);
      link.setAttribute('title', COPY_TOOLTIP);
      link.removeAttribute('target');
    }
  }

  return document.body.innerHTML;
}

export function ContentHtml({ html }: { html: string }) {
  const [notice, setNotice] = useState<{ message: string; success: boolean; id: number } | null>(null);
  const preparedHtml = useMemo(() => prepareContentLinks(html), [html]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (link.dataset.qortalInternalLink === 'true' || href.startsWith('#/')) {
      event.preventDefault();
      window.location.hash = href.slice(1);
      return;
    }

    const copyUrl = link.dataset.copyWeb2Url;
    if (copyUrl) {
      event.preventDefault();
      const copied = await copyText(copyUrl);
      setNotice({
        success: copied,
        message: copied ? 'Link copied successfully to clipboard' : 'Unable to copy link to clipboard',
        id: Date.now()
      });
    }
  }

  return (
    <>
      <div className="article-html" onClick={(event) => void handleClick(event)} dangerouslySetInnerHTML={{ __html: preparedHtml }} />
      {notice && <p className={`copy-status ${notice.success ? 'success' : 'error'}`} role="status">{notice.message}</p>}
    </>
  );
}

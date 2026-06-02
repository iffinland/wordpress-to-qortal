import { useState } from 'react';
import { internalRouteForWeb2Url } from '../../app/routes';

export function ContentHtml({ html }: { html: string }) {
  const [message, setMessage] = useState('');

  async function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#/')) return;
    const internalRoute = internalRouteForWeb2Url(href);

    if (internalRoute) {
      event.preventDefault();
      window.location.hash = internalRoute.slice(1);
      return;
    }

    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      await navigator.clipboard.writeText(href);
      setMessage('External Web2 link copied to clipboard.');
    }
  }

  return (
    <>
      <div className="article-html" onClick={(event) => void handleClick(event)} dangerouslySetInnerHTML={{ __html: html }} />
      {message && <p className="copy-status" role="status">{message}</p>}
    </>
  );
}

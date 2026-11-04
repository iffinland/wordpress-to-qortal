import { useMemo } from 'react';
import { sanitizeHtml } from '../lib/sanitize.js';

export function ContentHtml(props: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(props.html || ''), [props.html]);
  return <div className={'content-html' + (props.className ? ' ' + props.className : '')} dangerouslySetInnerHTML={{ __html: clean }} />;
}

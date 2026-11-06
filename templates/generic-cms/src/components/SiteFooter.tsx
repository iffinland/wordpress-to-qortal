import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { CmsTemplateConfig } from '../types';
import { openQortalLink } from '../lib/qortal.js';
import { QORTAL_ATTRIBUTION_LINK } from '../lib/links.js';

export const ATTRIBUTION_LINK = QORTAL_ATTRIBUTION_LINK;
const ATTRIBUTION_LABEL = 'Qortal Migration Studio CMS';

/**
 * Attribution is independent of the owner-editable footer text. It opens the
 * Qortal Web Builders site through the Hub OPEN_NEW_TAB bridge action; outside
 * Hub the destination is shown and copied so it can be pasted manually.
 */
export function SiteFooter(props: { config: CmsTemplateConfig; templateVersion: string; onCheckUpdates?: () => void }) {
  const [fallback, setFallback] = useState('');
  const label = ATTRIBUTION_LABEL + ' — open Qortal Web Builders in a new tab';
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      const result = await openQortalLink(ATTRIBUTION_LINK);
      if (result.ok) {
        setFallback('');
        return;
      }
      setFallback(result.message + ' Link: ' + ATTRIBUTION_LINK);
    }
  };
  return (
    <footer className="site-footer">
      {props.config.site.footerText ? <p className="site-footer__text">{props.config.site.footerText}</p> : null}
      <p className="site-footer__meta">
        {props.onCheckUpdates ? (
          <button type="button" className="site-footer__updates" onClick={props.onCheckUpdates}>
            Check for updates
          </button>
        ) : null}
        <a
          className="site-footer__attribution"
          href={ATTRIBUTION_LINK}
          target="_blank"
          rel="noopener noreferrer"
          onClick={open}
          aria-label={label}
        >
          {ATTRIBUTION_LABEL}
        </a>
        <span className="site-footer__version">Template v{props.templateVersion}</span>
      </p>
      {fallback ? <p className="site-footer__fallback" role="status">{fallback}</p> : null}
    </footer>
  );
}

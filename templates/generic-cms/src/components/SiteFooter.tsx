import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { CmsTemplateConfig } from '../types';
import { openQortalLink } from '../lib/qortal.js';

export const ATTRIBUTION_LINK = 'qortal://WEBSITE/Qortal%20Web%20Builders/';

/**
 * Attribution is separate from the editable footer text. Opening qortal://
 * goes through the Hub OPEN_NEW_TAB bridge action; outside Hub the href remains
 * a normal link so an installed protocol handler can still take over.
 */
export function SiteFooter(props: { config: CmsTemplateConfig; templateVersion: string; onCheckUpdates?: () => void }) {
  const [fallback, setFallback] = useState('');
  const label = 'Qortal. Template v' + props.templateVersion;
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      const result = await openQortalLink(ATTRIBUTION_LINK);
      if (result.ok) {
        setFallback('');
        return;
      }
      setFallback(result.message + ' Link: ' + ATTRIBUTION_LINK);
      try {
        window.location.href = ATTRIBUTION_LINK;
      } catch {
        // The message above is the fallback.
      }
    }
  };
  return (
    <footer className="site-footer">
      {props.config.site.footerText ? <p className="site-footer__text">{props.config.site.footerText}</p> : null}
      <p className="site-footer__meta">
        {props.config.site.ownerName ? <span>QDN name: {props.config.site.ownerName}. </span> : null}
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
          aria-label={label + ' — open Qortal Web Builders in a new tab'}
        >
          {label}
        </a>
      </p>
      {fallback ? <p className="site-footer__fallback" role="status">{fallback}</p> : null}
    </footer>
  );
}


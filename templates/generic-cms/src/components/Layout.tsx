import type { CSSProperties, ReactNode } from 'react';
import type { AppRoute, CmsTemplateConfig, ViewerIdentity } from '../types';
import { themeStyle } from '../lib/config.js';

function isActive(href: string, route: AppRoute) {
  if (href === '#/' && route.kind === 'home') return true;
  if (href.indexOf('#/posts') === 0 && (route.kind === 'posts' || route.kind === 'post')) return true;
  if (href.indexOf('#/archive') === 0 && route.kind === 'archive') return true;
  if (href.indexOf('#/search') === 0 && route.kind === 'search') return true;
  if (href.indexOf('#/admin') === 0 && route.kind === 'admin') return true;
  if (href.indexOf('#/category') === 0 && route.kind === 'category') return true;
  if (href.indexOf('#/tag') === 0 && route.kind === 'tag') return true;
  return false;
}

export function Layout(props: {
  children: ReactNode;
  config: CmsTemplateConfig;
  route: AppRoute;
  viewer: ViewerIdentity | null;
  viewerLoading?: boolean;
  templateVersion: string;
}) {
  return (
    <div className="qms-app" style={themeStyle(props.config) as CSSProperties}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#/" aria-label={props.config.site.title + ' home'}>
            <span className="brand__title">{props.config.site.title}</span>
            {props.config.site.tagline ? <span className="brand__tagline">{props.config.site.tagline}</span> : null}
          </a>
          <nav className="site-nav" aria-label="Primary">
            <ul className="site-nav__list">
              {props.config.navigation.map((item) => (
                <li key={item.label + item.href}>
                  <a
                    className="site-nav__link"
                    href={item.href}
                    aria-current={isActive(item.href, props.route) ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p className={'viewer-badge ' + (props.viewer && props.viewer.owner ? 'viewer-badge--owner' : '')}>
            {props.viewer ? (props.viewer.owner ? 'Owner mode' : 'Read-only') : props.viewerLoading ? 'Checking access' : 'Read-only'}
          </p>
        </div>
      </header>
      <main id="main-content" className="site-main" tabIndex={-1}>
        {props.children}
      </main>
      <footer className="site-footer">
        <p>{props.config.site.footerText || 'Published on Qortal QDN.'}</p>
        <p className="site-footer__meta">
          {props.config.site.ownerName ? 'QDN name: ' + props.config.site.ownerName + '. ' : ''}
          Template v{props.templateVersion}
        </p>
      </footer>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AppRoute, CmsTemplateConfig, ViewerIdentity } from '../types';
import { themeStyle } from '../lib/config.js';
import { ThemeToggle } from './ThemeToggle';
import { SiteFooter } from './SiteFooter';

function isActive(href: string, route: AppRoute) {
  if (href === '#/' && route.kind === 'home') return true;
  if (href.indexOf('#/posts') === 0 && (route.kind === 'posts' || route.kind === 'post')) return true;
  if (href.indexOf('#/archive') === 0 && route.kind === 'archive') return true;
  if (href.indexOf('#/search') === 0 && route.kind === 'search') return true;
  if (href.indexOf('#/gallery') === 0 && route.kind === 'gallery') return true;
  if (href.indexOf('#/admin') === 0 && route.kind === 'admin') return true;
  if (href.indexOf('#/category') === 0 && route.kind === 'category') return true;
  if (href.indexOf('#/tag') === 0 && route.kind === 'tag') return true;
  return false;
}

function publicNavigation(config: CmsTemplateConfig, owner: boolean, hasGalleries: boolean) {
  const items = config.navigation.filter((item) => {
    const isAdmin = String(item.href || '').replace(/\/+$/, '') === '#/admin' || item.adminOnly;
    return isAdmin ? owner : true;
  });
  if (hasGalleries && !items.some((item) => String(item.href || '').indexOf('#/gallery') === 0)) {
    return [...items, { label: 'Gallery', href: '#/gallery' }];
  }
  return items;
}

function withCoreLinks(items: Array<{ label: string; href: string; adminOnly?: boolean }>) {
  const has = (prefix: string) => items.some((item) => String(item.href || '').indexOf(prefix) === 0);
  const extra = [];
  if (!has('#/posts')) extra.push({ label: 'Posts', href: '#/posts' });
  if (!has('#/search')) extra.push({ label: 'Search', href: '#/search' });
  return extra.length ? [...items, ...extra] : items;
}

export function Layout(props: {
  children: ReactNode;
  config: CmsTemplateConfig;
  route: AppRoute;
  viewer: ViewerIdentity | null;
  viewerLoading?: boolean;
  templateVersion: string;
  themeMode?: 'light' | 'dark' | 'system';
  resolvedTheme?: 'light' | 'dark';
  onThemeChange?: (mode: 'light' | 'dark' | 'system') => void;
  hasGalleries?: boolean;
  updateBadge?: ReactNode;
  onCheckUpdates?: () => void;
  onConnectOwner?: () => void;
  onRetryIdentity?: () => void;
}) {
  const owner = Boolean(props.viewer && props.viewer.owner && props.viewer.nameRecordStatus === 'verified');
  const navigation = withCoreLinks(publicNavigation(props.config, owner, Boolean(props.hasGalleries)));
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const routeKey = JSON.stringify(props.route);
  useEffect(() => { setMenuOpen(false); }, [routeKey]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        if (buttonRef.current) buttonRef.current.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const resolved = props.resolvedTheme || 'dark';
  const canConnect = Boolean(!owner && !props.viewerLoading && props.viewer && props.viewer.action === 'connect' && props.onConnectOwner);
  const canRetry = Boolean(!owner && !props.viewerLoading && props.viewer && props.viewer.action === 'retry' && props.onRetryIdentity);
  return (
    <div className="qms-app" style={themeStyle(props.config, resolved) as CSSProperties} data-theme={resolved}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#/" aria-label={props.config.site.title + ' home'}>
            <span className="brand__title">{props.config.site.title}</span>
            {props.config.site.tagline ? <span className="brand__tagline">{props.config.site.tagline}</span> : null}
          </a>
          <button
            ref={buttonRef}
            type="button"
            className="menu-button"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="menu-button__icon" aria-hidden="true" />
            <span className="visually-hidden">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
          <div id="site-menu" className={'site-menu' + (menuOpen ? ' is-open' : '')}>
            <nav className="site-nav" aria-label="Primary">
              <ul className="site-nav__list">
                {navigation.map((item) => (
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
            <div className="site-header__tools">
              {props.updateBadge}
              <ThemeToggle mode={props.themeMode || 'system'} onChange={props.onThemeChange} />
              {canConnect ? (
                <button type="button" className="button button--ghost viewer-connect" onClick={props.onConnectOwner}>
                  Connect owner account
                </button>
              ) : null}
              {canRetry ? (
                <button type="button" className="button button--ghost viewer-connect" onClick={props.onRetryIdentity}>
                  Retry verification
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" className="site-main" tabIndex={-1}>
        {props.children}
      </main>
      <SiteFooter config={props.config} templateVersion={props.templateVersion} onCheckUpdates={props.onCheckUpdates} />
    </div>
  );
}


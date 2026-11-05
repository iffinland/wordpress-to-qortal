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
}) {
  const owner = Boolean(props.viewer && props.viewer.owner && props.viewer.nameRecordStatus === 'verified');
  const navigation = publicNavigation(props.config, owner, Boolean(props.hasGalleries));
  const resolved = props.resolvedTheme || 'dark';
  return (
    <div className="qms-app" style={themeStyle(props.config, resolved) as CSSProperties} data-theme={resolved}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#/" aria-label={props.config.site.title + ' home'}>
            <span className="brand__title">{props.config.site.title}</span>
            {props.config.site.tagline ? <span className="brand__tagline">{props.config.site.tagline}</span> : null}
          </a>
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
            <p className={'viewer-badge ' + (owner ? 'viewer-badge--owner' : '')}>
              {props.viewer ? (owner ? 'Owner mode' : 'Read-only') : props.viewerLoading ? 'Checking access' : 'Read-only'}
            </p>
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


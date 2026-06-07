import { Menu, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { primaryNavigation, SHOP_LINK_URL, siteConfig, socialLinks } from '../../config/site';
import type { SearchResult } from '../../types/content';
import { copyText } from '../../utils/clipboard';
import { FollowButton } from '../follow/FollowButton';
import { InstantSearch } from '../search/InstantSearch';

const COPY_TOOLTIP = 'Click this link to copy it to the clipboard';

export function SiteHeader({ searchIndex }: { searchIndex: SearchResult[] }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ message: string; success: boolean } | null>(null);

  useEffect(() => {
    if (!copyNotice) return;
    const timeout = window.setTimeout(() => setCopyNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  async function copyExternalLink(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    const copied = await copyText(url);
    setCopyNotice({
      success: copied,
      message: copied ? 'Link copied successfully to clipboard' : 'Unable to copy link to clipboard'
    });
  }

  return (
    <header className="site-header">
      {copyNotice && <p className={`copy-status ${copyNotice.success ? 'success' : 'error'}`} role="status">{copyNotice.message}</p>}
      <div className="top-strip">
        <a className="mobile-start-link" href="#/best-of-corbett">New? Start Here!</a>
        <div className="social-links">
          {socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(event) => void copyExternalLink(event, link.href)}
              data-copy-tooltip={COPY_TOOLTIP}
              title={COPY_TOOLTIP}
              aria-label={`${link.label}: ${COPY_TOOLTIP}`}
            >
              <img src={link.icon} alt={link.label} />
            </a>
          ))}
        </div>
        <nav className="account-links" aria-label="Account links">
          <a
            href={SHOP_LINK_URL}
            onClick={(event) => void copyExternalLink(event, SHOP_LINK_URL)}
            data-copy-tooltip={COPY_TOOLTIP}
            title={COPY_TOOLTIP}
          >
            Shop
          </a>
          <a href="#/member">Subscribe</a>
          <a href="#/member">Manage Account</a>
          <a href="#/admin">Author Backend</a>
        </nav>
      </div>

      <div className="brand-row">
        <a className="start-button" href="#/best-of-corbett">New? Start Here!</a>
        <a className="brand-logo" href="#/" aria-label={siteConfig.title}>
          <img src={siteConfig.logo} alt={siteConfig.title} />
        </a>
        <div className="header-actions">
          <FollowButton />
          <InstantSearch index={searchIndex} />
        </div>
      </div>

      <div className="mobile-controls">
        <span className="mobile-follow-control"><FollowButton compact /></span>
        <button type="button" onClick={() => setMobileSearchOpen((current) => !current)} title="Search"><Search size={22} /></button>
        <button type="button" onClick={() => setMobileMenuOpen((current) => !current)} title="Menu">{mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}</button>
      </div>
      {mobileSearchOpen && <div className="mobile-search"><InstantSearch index={searchIndex} compact onNavigate={() => setMobileSearchOpen(false)} /></div>}

      <nav className={`main-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label="Main navigation">
        {primaryNavigation.map((item) => (
          item.children?.length ? (
            <div className="nav-dropdown" key={item.label}>
              <button type="button" className="nav-dropdown-trigger" aria-haspopup="true">
                {item.label}
              </button>
              <div className="nav-dropdown-menu" role="menu">
                {item.children.map((child) => (
                  <a key={child.label} href={child.href} onClick={() => setMobileMenuOpen(false)} role="menuitem">
                    {child.label}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <a
              key={item.label}
              href={item.href}
              onClick={(event) => {
                setMobileMenuOpen(false);
                if (item.copyToClipboard) void copyExternalLink(event, item.href);
              }}
              data-copy-tooltip={item.copyToClipboard ? COPY_TOOLTIP : undefined}
              title={item.copyToClipboard ? COPY_TOOLTIP : undefined}
            >
              {item.label}
            </a>
          )
        ))}
      </nav>
    </header>
  );
}

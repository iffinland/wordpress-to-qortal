import { Menu, Search, X } from 'lucide-react';
import { useState } from 'react';
import { primaryNavigation, siteConfig, socialLinks } from '../../config/site';
import type { SearchResult } from '../../types/content';
import { FollowButton } from '../follow/FollowButton';
import { InstantSearch } from '../search/InstantSearch';

export function SiteHeader({ searchIndex }: { searchIndex: SearchResult[] }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="top-strip">
        <a className="mobile-start-link" href="#/member">New? Start Here!</a>
        <div className="social-links">
          {socialLinks.map((link) => <a key={link.label} href={link.href} target="_blank" rel="noreferrer" title={link.label}>{link.shortLabel}</a>)}
        </div>
        <nav className="account-links" aria-label="Account links">
          <a href="#/pages/shop">Shop</a>
          <a href="#/member">Subscribe</a>
          <a href="#/member">Manage Account</a>
          <a href="#/admin">Author Backend</a>
        </nav>
      </div>

      <div className="brand-row">
        <a className="start-button" href="#/member">New? Start Here!</a>
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
        {primaryNavigation.map((item) => <a key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)}>{item.label}</a>)}
      </nav>
    </header>
  );
}

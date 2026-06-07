import { siteConfig } from '../../config/site';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>{siteConfig.title}</strong>
        <span>{siteConfig.tagline}</span>
      </div>
    </footer>
  );
}

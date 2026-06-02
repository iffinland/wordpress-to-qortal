import { siteConfig } from '../../config/site';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <a className="footer-signup" href="#/member">Get Emails About New Posts</a>
      <div>
        <strong>{siteConfig.title}</strong>
        <span>{siteConfig.tagline}</span>
      </div>
      <p>Qortal-native public archive scaffold. Membership, newsletter and shop integrations follow in later phases.</p>
    </footer>
  );
}

import { ContentHtml } from '../components/content/ContentHtml';
import type { PublicPage } from '../types/content';

const jamesImage = '<figure class="about-profile-media"><img src="./assets/about/james-corbett-2025-headshot.jpg" alt="James Corbett" /><figcaption>James Corbett</figcaption></figure>';
const brocImage = '<figure class="about-profile-media"><img src="./assets/about/broc-west-2025-headshot.jpg" alt="Broc West" /><figcaption>Broc West</figcaption></figure>';

function insertAfterHeading(html: string, headingPattern: RegExp, mediaHtml: string) {
  if (html.includes(mediaHtml)) return html;
  if (!headingPattern.test(html)) return `${mediaHtml}${html}`;
  return html.replace(headingPattern, (heading) => `${heading}${mediaHtml}`);
}

function withAboutAssets(html: string) {
  let nextHtml = insertAfterHeading(html, /<h[2-4][^>]*>\s*JAMES CORBETT\s*<\/h[2-4]>/i, jamesImage);
  nextHtml = insertAfterHeading(nextHtml, /<h[2-4][^>]*>\s*BROC WEST[^<]*Video Editor\s*<\/h[2-4]>/i, brocImage);
  return nextHtml;
}

export function AboutPage({ page }: { page: PublicPage }) {
  return (
    <section className="page-shell static-page about-page">
      <article>
        <h1>{page.title}</h1>
        <ContentHtml html={withAboutAssets(page.contentHtml)} />
      </article>
    </section>
  );
}

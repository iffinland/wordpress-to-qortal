import { ContentHtml } from '../components/content/ContentHtml';
import brocHeadshot from '../assets/about/broc-west-2025-headshot.jpg';
import jamesHeadshot from '../assets/about/james-corbett-2025-headshot.jpg';
import type { PublicPage } from '../types/content';

const jamesImage = `<figure class="about-profile-media"><img src="${jamesHeadshot}" alt="James Corbett" /><figcaption>James Corbett</figcaption></figure>`;
const brocImage = `<figure class="about-profile-media"><img src="${brocHeadshot}" alt="Broc West" /><figcaption>Broc West</figcaption></figure>`;

function isLegacyProfileImage(element: Element) {
  const marker = [
    element.getAttribute('src'),
    element.getAttribute('data-lazy-src'),
    element.getAttribute('srcset'),
    element.getAttribute('class')
  ].filter(Boolean).join(' ');

  return /James_Corbett_2025_headshot|Broc_West_2025_headshot|wp-image-274201|wp-image-274207/i.test(marker);
}

function removeLegacyProfileImages(html: string) {
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<div[^>]*class="[^"]*wp-caption[^"]*"[^>]*>[\s\S]*?(?:James_Corbett_2025_headshot|Broc_West_2025_headshot)[\s\S]*?<\/div>/gi, '')
      .replace(/<noscript>[\s\S]*?(?:James_Corbett_2025_headshot|Broc_West_2025_headshot)[\s\S]*?<\/noscript>/gi, '');
  }

  const document = new DOMParser().parseFromString(html || '', 'text/html');

  for (const noscript of Array.from(document.querySelectorAll('noscript'))) {
    if (/James_Corbett_2025_headshot|Broc_West_2025_headshot/i.test(noscript.innerHTML)) {
      noscript.remove();
    }
  }

  for (const image of Array.from(document.querySelectorAll('img'))) {
    if (!isLegacyProfileImage(image)) continue;
    const container =
      image.closest('.wp-caption')
      || image.closest('figure')
      || image.closest('div[id^="attachment_"]')
      || image.closest('a')
      || image;
    container.remove();
  }

  return document.body.innerHTML;
}

function insertAfterHeading(html: string, headingPattern: RegExp, mediaHtml: string) {
  if (html.includes(mediaHtml)) return html;
  if (!headingPattern.test(html)) return `${mediaHtml}${html}`;
  return html.replace(headingPattern, (heading) => `${heading}${mediaHtml}`);
}

function withAboutAssets(html: string) {
  let nextHtml = removeLegacyProfileImages(html);
  nextHtml = insertAfterHeading(nextHtml, /<h[2-4][^>]*>\s*JAMES CORBETT\s*<\/h[2-4]>/i, jamesImage);
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

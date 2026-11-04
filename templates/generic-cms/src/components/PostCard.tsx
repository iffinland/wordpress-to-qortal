import { pageHref, postHref } from '../lib/routes.js';
import { formatDate } from '../lib/text.js';
import type { CmsContentItem } from '../types';
import { createQdnResourceUrl } from '../lib/qortal.js';
import type { CmsDataset } from '../types';

export function PostCard(props: { item: CmsContentItem; dataset: CmsDataset; headingLevel?: 2 | 3 }) {
  const item = props.item;
  const Heading = props.headingLevel === 3 ? 'h3' : 'h2';
  const href = item.type === 'page' ? pageHref(item.slug) : postHref(item.slug);
  const featured = item.featuredImageRef;
  const imageUrl = featured
    ? createQdnResourceUrl(featured.service, featured.name || props.dataset.site.ownerName, featured.identifier)
    : '';
  return (
    <article className="post-card">
      {imageUrl ? (
        <a className="post-card__media" href={href} tabIndex={-1} aria-hidden="true">
          <img src={imageUrl} alt="" loading="lazy" decoding="async" />
        </a>
      ) : null}
      <div className="post-card__body">
        <p className="post-card__kind">{item.type === 'page' ? 'Page' : 'Post'}</p>
        <Heading className="post-card__title"><a href={href}>{item.title}</a></Heading>
        {item.publishedAt ? (
          <p className="post-card__date"><time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time></p>
        ) : null}
        {item.excerpt ? <p className="post-card__excerpt">{item.excerpt}</p> : null}
      </div>
    </article>
  );
}

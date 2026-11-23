import { PostQuickActions } from '../components/PostQuickActions';
import { ContentHtml } from '../components/ContentHtml';
import { Pagination } from '../components/Pagination';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from '../pages/NotFoundPage';
import { publishedPosts, paginate, postsForTerm } from '../lib/archive.js';
import { postsForSection } from '../lib/sections.js';
import { categoryHref, tagHref, pageHref, postHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import { formatDate } from '../lib/text.js';
import { attachmentsInHtml } from '../lib/attachments.js';
import { createQdnResourceUrl } from '../lib/qortal.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, CmsTerm } from '../types';
import type { TemplateHomeProps, TemplatePostsProps, TemplateTermProps, TemplatePostProps, TemplatePageProps } from './types';

function categoryFor(dataset: CmsDataset, item: CmsContentItem): CmsTerm | null {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function videoAttachmentsIn(html: string) {
  return attachmentsInHtml(html).filter((meta) => meta && meta.kind === 'video');
}

function VideoCard(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const category = categoryFor(props.dataset, props.item);
  const href = postHref(props.item.slug);
  return (
    <article className="video-card">
      <a className="video-card__media" href={href} tabIndex={-1} aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="video-card__placeholder" />}
        <span className="video-card__play" aria-hidden="true">▶</span>
      </a>
      <div className="video-card__body">
        <p className="video-meta">
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Video</span>}
          {props.item.publishedAt ? <time dateTime={props.item.publishedAt}>{formatDate(props.item.publishedAt)}</time> : null}
        </p>
        <h3 className="video-card__title"><a href={href}>{props.item.title}</a></h3>
        {props.item.excerpt ? <p className="video-card__excerpt">{props.item.excerpt}</p> : null}
        <span className="video-card__watch">Watch video →</span>
      </div>
    </article>
  );
}

function VideoFilter(props: { dataset: CmsDataset }) {
  if (!props.dataset.availability.categories || !props.dataset.categories.length) return null;
  return (
    <nav className="video-filter" aria-label="Video collections">
      <a href="#/posts">All videos</a>
      {props.dataset.categories.slice(0, 10).map((term) => <a key={term.id} href={categoryHref(term.slug)}>{term.name}</a>)}
    </nav>
  );
}

function SeriesGrid(props: { dataset: CmsDataset }) {
  const posts = publishedPosts(props.dataset.posts);
  const series = props.dataset.categories.map((term) => {
    const items = posts.filter((item: CmsContentItem) => item.categoryIds && item.categoryIds.includes(term.id));
    const cover = items.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || null;
    return { term, count: items.length, image: cover ? featuredImageUrlForItem(cover, props.dataset) : '' };
  }).filter((entry) => entry.count > 0);
  if (!series.length) return null;
  return (
    <section className="video-series-section" aria-labelledby="video-series-title">
      <div className="video-section-head">
        <p className="video-eyebrow">Collections</p>
        <h2 id="video-series-title">Series</h2>
        <a href="#/posts">All videos</a>
      </div>
      <div className="video-series-grid">
        {series.map((entry) => (
          <a className="video-series-card" key={entry.term.id} href={categoryHref(entry.term.slug)}>
            <div className="video-series-card__media">
              {entry.image ? <img src={entry.image} alt="" loading="lazy" decoding="async" /> : <span className="video-series-card__placeholder" />}
              <span className="video-series-card__count">{entry.count} {entry.count === 1 ? 'video' : 'videos'}</span>
            </div>
            <h3>{entry.term.name}</h3>
          </a>
        ))}
      </div>
    </section>
  );
}

export function VideoHome(props: TemplateHomeProps) {
  const posts = publishedPosts(props.dataset.posts);
  const featured = posts.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || posts[0] || null;
  const featuredImage = featured ? featuredImageUrlForItem(featured, props.dataset) : '';
  const category = featured ? categoryFor(props.dataset, featured) : null;

  return (
    <div className="page video-home">
      <h1 className="visually-hidden">Home</h1>

      <section className="video-featured" aria-labelledby="video-featured-title">
        <div className="video-featured__media">
          {featuredImage ? <img src={featuredImage} alt="" decoding="async" /> : <div className="video-featured__wash" aria-hidden="true" />}
          <span className="video-featured__play" aria-hidden="true">▶</span>
        </div>
        <div className="video-featured__body">
          <p className="video-eyebrow">Featured video</p>
          {featured ? (
            <>
              <h2 id="video-featured-title">{featured.title}</h2>
              <p className="video-featured__meta">
                {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : null}
                {featured.publishedAt ? <time dateTime={featured.publishedAt}>{formatDate(featured.publishedAt)}</time> : null}
              </p>
              {featured.excerpt ? <p className="video-featured__excerpt">{featured.excerpt}</p> : null}
              <a className="button video-featured__action" href={postHref(featured.slug)}>Watch video</a>
            </>
          ) : (
            <h2 id="video-featured-title">{props.dataset.site.tagline || 'Video stories and media'}</h2>
          )}
        </div>
      </section>

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Videos are unavailable" message="The posts index could not be read. This is not an empty video library." />
      ) : posts.length === 0 ? (
        <StateNotice state="empty" title="No videos yet" message="The catalog loaded successfully and currently contains no published posts." />
      ) : (
        <>
          <SeriesGrid dataset={props.dataset} />
          <section className="video-gallery-section" aria-labelledby="video-gallery-title">
            <div className="video-section-head">
              <p className="video-eyebrow">Library</p>
              <h2 id="video-gallery-title">Latest videos</h2>
              <a href="#/posts">All videos</a>
            </div>
            <div className="video-grid">
              {posts.slice(0, 9).map((item: CmsContentItem) => <VideoCard key={item.id} dataset={props.dataset} item={item} />)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function VideoPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page video-index">
      <header className="video-index__head">
        <p className="video-eyebrow">Video library</p>
        <h1>Videos</h1>
        <p>Documentaries, interviews, tutorials and media from the catalog.</p>
      </header>
      <VideoFilter dataset={props.dataset} />
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Videos are unavailable" message="The posts index could not be read from QDN. This is not an empty video library." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No videos yet" message="The catalog is readable and contains no published posts." />
      ) : (
        <>
          <div className="video-grid">
            {page.items.map((item: CmsContentItem) => <VideoCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Video pages" hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')} />
        </>
      )}
    </div>
  );
}

export function VideoTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <div className="page video-index">
        <h1>{isCategory ? 'Series' : 'Tags'}</h1>
        <StateNotice state="partial" title={(isCategory ? 'Series' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Series' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page video-index">
      <header className="video-index__head">
        <p className="video-eyebrow">{isCategory ? 'Series' : 'Tag'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p>{term.count} videos</p> : null}
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Videos are unavailable" message="The posts index could not be read, so this series cannot list its videos." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published videos" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="video-grid">
            {page.items.map((item: CmsContentItem) => <VideoCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Video pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
        </>
      )}
    </div>
  );
}

function videoTaxonomy(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

function VideoTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = videoTaxonomy(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="video-detail__terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="video-terms__heading">Series</h2>
          <ul className="video-tags">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="video-terms__heading">Tags</h2>
          <ul className="video-tags">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function VideoPost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow video-detail video-detail--state" aria-busy="true">
        <StateNotice state="loading" title="Loading video..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow video-detail video-detail--state">
        <StateNotice state="error" title="This video could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow video-detail video-detail--state">
          <StateNotice state="partial" title="Videos are unavailable" message="The posts index could not be read from QDN. This is not evidence that the video does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Video not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow video-detail video-detail--state" aria-busy="true">
        <StateNotice state="loading" title="Loading video content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const videoMeta = videoAttachmentsIn(content.html)[0] || null;
  const poster = videoMeta && videoMeta.poster
    ? createQdnResourceUrl('IMAGE', videoMeta.name, videoMeta.poster)
    : featuredImageUrlForItem(item, props.dataset);
  const category = categoryFor(props.dataset, item);
  const related = publishedPosts(props.dataset.posts)
    .filter((entry: CmsContentItem) => entry.id !== item.id)
    .filter((entry: CmsContentItem) => !category || (entry.categoryIds && entry.categoryIds.includes(category.id)))
    .slice(0, 3);
  const fallbackRelated = related.length ? related : publishedPosts(props.dataset.posts).filter((entry: CmsContentItem) => entry.id !== item.id).slice(0, 3);

  return (
    <article className="page video-detail">
      <header className="video-detail__head">
        <nav className="video-breadcrumb" aria-label="Breadcrumb">
          <a href="#/posts">Videos</a>
          <span aria-hidden="true">/</span>
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Video</span>}
        </nav>
        <p className="video-eyebrow">{videoMeta ? 'Video' : 'Media'}</p>
        <h1>{content.title || item.title}</h1>
        <p className="video-meta video-detail__byline">
          {category ? <span>{category.name}</span> : null}
          {content.author ? <span>By {content.author}</span> : null}
          {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
          {content.modifiedAt ? <span>Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></span> : null}
        </p>
      </header>

      <div className="video-detail__player" id="video-player" aria-label="Video playback">
        {!videoMeta && poster ? (
          <div className="video-detail__poster" aria-hidden="true">
            <img src={poster} alt="" decoding="async" />
            <span className="video-detail__play">▶</span>
          </div>
        ) : null}
        <PostQuickActions key={item.id} config={props.config || cmsConfig} item={item}><ContentHtml html={content.html} highlightTerms={props.highlightTerms} /></PostQuickActions>
      </div>

      <div className="video-detail__body">
        <VideoTerms dataset={props.dataset} item={item} />
        {props.previous || props.next ? (
          <nav className="video-detail__nav" aria-label="Video navigation">
            {props.previous ? (
              <a className="video-detail__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span>Previous video</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="video-detail__nav-link video-detail__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span>Next video</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
        ) : null}
        <p className="video-back"><a href="#/posts">← Back to video library</a></p>
      </div>

      {fallbackRelated.length > 0 ? (
        <section className="video-related" aria-labelledby="video-related-title">
          <div className="video-section-head">
            <p className="video-eyebrow">Keep watching</p>
            <h2 id="video-related-title">Related videos</h2>
            <a href="#/posts">All videos</a>
          </div>
          <div className="video-grid">
            {fallbackRelated.map((entry: CmsContentItem) => <VideoCard key={entry.id} dataset={props.dataset} item={entry} />)}
          </div>
        </section>
      ) : null}
    </article>
  );
}

export function VideoPage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow video-page video-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow video-page video-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow video-page video-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow video-page video-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page video-page">
      <header className="video-index__head">
        <p className="video-eyebrow">Page</p>
        <h1>{content.title || item.title}</h1>
        {content.modifiedAt ? <p className="video-meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>
      <div className="video-detail__body video-page__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      </div>
      {assigned.totalItems > 0 ? (
        <section className="video-related" aria-labelledby="video-page-videos-title">
          <div className="video-section-head">
            <p className="video-eyebrow">Related</p>
            <h2 id="video-page-videos-title">Videos on this page</h2>
            <a href="#/posts">All videos</a>
          </div>
          <div className="video-grid">
            {assigned.items.map((post: CmsContentItem) => <VideoCard key={post.id} dataset={props.dataset} item={post} />)}
          </div>
          <Pagination page={assigned.page} totalPages={assigned.totalPages} totalItems={assigned.totalItems} label="Page videos" hrefForPage={(value: number) => pageHref(item.slug, value)} />
        </section>
      ) : null}
    </article>
  );
}

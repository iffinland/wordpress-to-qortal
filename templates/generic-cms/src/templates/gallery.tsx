import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { ContentHtml } from '../components/ContentHtml';
import { Pagination } from '../components/Pagination';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from '../pages/NotFoundPage';
import { publishedPosts, paginate, postsForTerm } from '../lib/archive.js';
import { postsForSection } from '../lib/sections.js';
import { categoryHref, tagHref, pageHref, postHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import { formatDate } from '../lib/text.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, CmsTerm } from '../types';
import type { TemplateHomeProps, TemplatePostsProps, TemplateTermProps, TemplatePostProps, TemplatePageProps } from './types';

type LightboxImage = { src: string; alt: string } | null;

function useLightbox() {
  const [image, setImage] = useState<LightboxImage>(null);
  return {
    image,
    open: (src: string, alt: string) => setImage({ src, alt }),
    close: () => setImage(null)
  };
}

function Lightbox(props: { image: LightboxImage; onClose: () => void }) {
  useEffect(() => {
    if (!props.image) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.image, props.onClose]);

  if (!props.image) return null;
  return (
    <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label="Full-size image" onClick={props.onClose}>
      <button
        type="button"
        className="gallery-lightbox__close"
        onClick={(event) => { event.stopPropagation(); props.onClose(); }}
        aria-label="Close full-size image"
      >
        Close
      </button>
      <img
        src={props.image.src}
        alt={props.image.alt}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function categoryFor(dataset: CmsDataset, item: CmsContentItem): CmsTerm | null {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function galleryHref(item: CmsContentItem) {
  return postHref(item.slug);
}

function GalleryCard(props: { dataset: CmsDataset; item: CmsContentItem; onOpen: (src: string, alt: string) => void }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const category = categoryFor(props.dataset, props.item);
  const href = galleryHref(props.item);
  return (
    <figure className="gallery-card">
      <div className="gallery-card__media">
        <a className="gallery-card__link" href={href} tabIndex={-1} aria-hidden="true">
          {image
            ? <img src={image} alt={props.item.featuredImageAlt || props.item.title} loading="lazy" decoding="async" />
            : <span className="gallery-card__placeholder" />}
        </a>
        {image ? (
          <button
            type="button"
            className="gallery-card__zoom"
            onClick={() => props.onOpen(image, props.item.title)}
            aria-label={'View ' + props.item.title + ' full size'}
          >
            Full size
          </button>
        ) : null}
      </div>
      <figcaption className="gallery-card__caption">
        <p className="gallery-meta">
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Photograph</span>}
          {props.item.publishedAt ? <time dateTime={props.item.publishedAt}>{formatDate(props.item.publishedAt)}</time> : null}
        </p>
        <h3 className="gallery-card__title"><a href={href}>{props.item.title}</a></h3>
      </figcaption>
    </figure>
  );
}

function GalleryFilter(props: { dataset: CmsDataset }) {
  if (!props.dataset.availability.categories || !props.dataset.categories.length) return null;
  return (
    <nav className="gallery-filter" aria-label="Photo collections">
      <a href="#/posts">All photographs</a>
      {props.dataset.categories.slice(0, 10).map((term) => (
        <a key={term.id} href={categoryHref(term.slug)}>{term.name}</a>
      ))}
    </nav>
  );
}

function AlbumGrid(props: { dataset: CmsDataset }) {
  const posts = publishedPosts(props.dataset.posts);
  const albums = props.dataset.categories.map((term) => {
    const items = posts.filter((item: CmsContentItem) => item.categoryIds && item.categoryIds.includes(term.id));
    const cover = items.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || null;
    return {
      term,
      count: items.length,
      image: cover ? featuredImageUrlForItem(cover, props.dataset) : ''
    };
  });
  if (!albums.length) return null;
  return (
    <section className="gallery-collections" aria-labelledby="gallery-collections-title">
      <div className="gallery-section-head">
        <p className="gallery-eyebrow">Collections</p>
        <h2 id="gallery-collections-title">Albums</h2>
        <a href="#/posts">All photographs</a>
      </div>
      <div className="gallery-albums">
        {albums.map((album) => (
          <a className="gallery-album" key={album.term.id} href={categoryHref(album.term.slug)}>
            <div className="gallery-album__media">
              {album.image ? <img src={album.image} alt="" loading="lazy" decoding="async" /> : <span className="gallery-album__placeholder" />}
              <span className="gallery-album__count">{album.count} {album.count === 1 ? 'photo' : 'photos'}</span>
            </div>
            <h3>{album.term.name}</h3>
          </a>
        ))}
      </div>
    </section>
  );
}

export function GalleryHome(props: TemplateHomeProps) {
  const posts = publishedPosts(props.dataset.posts);
  const hero = posts.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || posts[0] || null;
  const heroImage = hero ? featuredImageUrlForItem(hero, props.dataset) : '';
  const lightbox = useLightbox();

  return (
    <div className="page gallery-home">
      <h1 className="visually-hidden">Home</h1>
      <section className="gallery-hero" aria-labelledby="gallery-hero-title">
        {heroImage ? <img className="gallery-hero__image" src={heroImage} alt="" decoding="async" /> : <div className="gallery-hero__wash" aria-hidden="true" />}
        <div className="gallery-hero__overlay" aria-hidden="true" />
        <div className="gallery-hero__inner">
          <p className="gallery-eyebrow">Photography / Visual stories</p>
          <h2 id="gallery-hero-title">Light, place and story.</h2>
          <p className="gallery-hero__intro">
            {props.dataset.site.description || props.dataset.site.tagline || 'A visual journal published directly from Qortal QDN.'}
          </p>
          <div className="gallery-hero__actions">
            <a className="button" href="#/posts">Explore gallery</a>
            {hero ? <a className="button button--ghost" href={galleryHref(hero)}>Featured story</a> : null}
          </div>
        </div>
        {heroImage ? (
          <button className="gallery-hero__zoom" type="button" onClick={() => lightbox.open(heroImage, hero ? hero.title : 'Featured photograph')}>
            View full size
          </button>
        ) : null}
      </section>

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Photographs are unavailable" message="The posts index could not be read. This is not an empty gallery." />
      ) : posts.length === 0 ? (
        <StateNotice state="empty" title="No photographs yet" message="The catalog loaded successfully and currently contains no published posts." />
      ) : (
        <>
          <AlbumGrid dataset={props.dataset} />
          <section className="gallery-recent" aria-labelledby="gallery-recent-title">
            <div className="gallery-section-head">
              <p className="gallery-eyebrow">Gallery</p>
              <h2 id="gallery-recent-title">Recent work</h2>
              <a href="#/posts">All photographs</a>
            </div>
            <div className="gallery-masonry">
              {posts.slice(0, 9).map((item: CmsContentItem) => (
                <GalleryCard key={item.id} dataset={props.dataset} item={item} onOpen={lightbox.open} />
              ))}
            </div>
          </section>
        </>
      )}
      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </div>
  );
}

export function GalleryPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  const lightbox = useLightbox();
  return (
    <div className="page gallery-index">
      <header className="gallery-index__head">
        <p className="gallery-eyebrow">Gallery</p>
        <h1>Photographs</h1>
        <p>A collection of visual work published from Qortal QDN.</p>
      </header>
      <GalleryFilter dataset={props.dataset} />
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Photographs are unavailable" message="The posts index could not be read from QDN. This is not an empty gallery." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No photographs yet" message="The catalog is readable and contains no published posts." />
      ) : (
        <>
          <div className="gallery-masonry">
            {page.items.map((item: CmsContentItem) => <GalleryCard key={item.id} dataset={props.dataset} item={item} onOpen={lightbox.open} />)}
          </div>
          <Pagination
            page={page.page}
            totalPages={page.totalPages}
            totalItems={page.totalItems}
            label="Photograph pages"
            hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')}
          />
        </>
      )}
      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </div>
  );
}

export function GalleryTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  const lightbox = useLightbox();
  if (!available) {
    return (
      <div className="page gallery-index">
        <h1>{isCategory ? 'Collections' : 'Tags'}</h1>
        <StateNotice state="partial" title={(isCategory ? 'Collections' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
        <Lightbox image={lightbox.image} onClose={lightbox.close} />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Collection' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page gallery-index">
      <header className="gallery-index__head">
        <p className="gallery-eyebrow">{isCategory ? 'Collection' : 'Tag'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p>{term.count} photographs</p> : null}
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Photographs are unavailable" message="The posts index could not be read, so this collection cannot list its photographs." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published photographs" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="gallery-masonry">
            {page.items.map((item: CmsContentItem) => <GalleryCard key={item.id} dataset={props.dataset} item={item} onOpen={lightbox.open} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Collection pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
        </>
      )}
      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </div>
  );
}

function galleryTaxonomy(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

function GalleryTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = galleryTaxonomy(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="gallery-article__terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="gallery-terms__heading">Collections</h2>
          <ul className="gallery-tags">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="gallery-terms__heading">Tags</h2>
          <ul className="gallery-tags">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

function GalleryReading(props: { html: string; highlightTerms?: string[]; onOpen: (src: string, alt: string) => void }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && target.tagName === 'IMG') {
      const image = target as HTMLImageElement;
      if (image.src) {
        event.preventDefault();
        props.onOpen(image.currentSrc || image.src, image.alt || '');
      }
    }
  };
  return (
    <div className="gallery-reading" onClick={onClick}>
      <ContentHtml html={props.html} highlightTerms={props.highlightTerms} />
      <p className="gallery-reading__hint">Click any image to view it full size.</p>
    </div>
  );
}

export function GalleryPost(props: TemplatePostProps) {
  const lightbox = useLightbox();
  if (props.loading) {
    return (
      <div className="page page--narrow gallery-article gallery-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading photograph..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow gallery-article gallery-article--state">
        <StateNotice state="error" title="This photograph could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow gallery-article gallery-article--state">
          <StateNotice state="partial" title="Photographs are unavailable" message="The posts index could not be read from QDN. This is not evidence that the photograph does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Photograph not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow gallery-article gallery-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading photograph content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const image = featuredImageUrlForItem(item, props.dataset);
  const category = categoryFor(props.dataset, item);
  const title = content.title || item.title;

  return (
    <article className="page gallery-article">
      <header className={'gallery-article__hero' + (image ? ' gallery-article__hero--image' : '')}>
        {image ? <img src={image} alt={item.featuredImageAlt || item.title} decoding="async" /> : <div className="gallery-article__wash" aria-hidden="true" />}
        {image ? (
          <button type="button" className="gallery-article__zoom" onClick={() => lightbox.open(image, item.featuredImageAlt || item.title)}>
            View full size
          </button>
        ) : null}
      </header>

      <div className="gallery-article__head">
        <nav className="gallery-breadcrumb" aria-label="Breadcrumb">
          <a href="#/posts">Gallery</a>
          <span aria-hidden="true">/</span>
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Photograph</span>}
        </nav>
        <h1>{title}</h1>
        <p className="gallery-meta gallery-article__byline">
          {content.author ? <span>By {content.author}</span> : null}
          {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
          {content.modifiedAt ? <span>Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></span> : null}
        </p>
      </div>

      <div className="gallery-article__body">
        <GalleryReading html={content.html} highlightTerms={props.highlightTerms} onOpen={lightbox.open} />
        <GalleryTerms dataset={props.dataset} item={item} />
        {props.previous || props.next ? (
          <nav className="gallery-article__nav" aria-label="Photograph navigation">
            {props.previous ? (
              <a className="gallery-article__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span>Previous</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="gallery-article__nav-link gallery-article__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span>Next</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
        ) : null}
        <p className="gallery-back"><a href="#/posts">← Back to gallery</a></p>
      </div>
      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </article>
  );
}

export function GalleryPage(props: TemplatePageProps) {
  const lightbox = useLightbox();
  if (props.loading) {
    return (
      <div className="page page--narrow gallery-page gallery-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow gallery-page gallery-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow gallery-page gallery-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow gallery-page gallery-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page gallery-page">
      <header className="gallery-page__head">
        <p className="gallery-eyebrow">Page</p>
        <h1>{content.title || item.title}</h1>
        {content.modifiedAt ? <p className="gallery-meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>
      <div className="gallery-article__body">
        <GalleryReading html={content.html} highlightTerms={props.highlightTerms} onOpen={lightbox.open} />
      </div>
      {assigned.totalItems > 0 ? (
        <section className="gallery-recent" aria-labelledby="gallery-page-photos-title">
          <div className="gallery-section-head">
            <p className="gallery-eyebrow">Related</p>
            <h2 id="gallery-page-photos-title">Photographs on this page</h2>
            <a href="#/posts">All photographs</a>
          </div>
          <div className="gallery-masonry">
            {assigned.items.map((post: CmsContentItem) => <GalleryCard key={post.id} dataset={props.dataset} item={post} onOpen={lightbox.open} />)}
          </div>
          <Pagination
            page={assigned.page}
            totalPages={assigned.totalPages}
            totalItems={assigned.totalItems}
            label="Page photographs"
            hrefForPage={(value: number) => pageHref(item.slug, value)}
          />
        </section>
      ) : null}
      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </article>
  );
}

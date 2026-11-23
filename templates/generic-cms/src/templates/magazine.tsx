import { PostQuickActions } from '../components/PostQuickActions';
import { ContentHtml } from '../components/ContentHtml';
import { Pagination } from '../components/Pagination';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from '../pages/NotFoundPage';
import { publishedPosts, paginate, postsForTerm } from '../lib/archive.js';
import { homePostsFilter, postsForSection } from '../lib/sections.js';
import { categoryHref, tagHref, pageHref, postHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import { formatDate } from '../lib/text.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, CmsTerm } from '../types';
import type { SiteTemplate, TemplateHomeProps, TemplatePostsProps, TemplateTermProps, TemplatePostProps, TemplatePageProps } from './types';

function itemHref(item: CmsContentItem): string {
  return item.type === 'page' ? pageHref(item.slug) : postHref(item.slug);
}

function categoryName(dataset: CmsDataset, item: CmsContentItem): string {
  const id = item.categoryIds && item.categoryIds[0];
  if (!id) return 'Story';
  const term = dataset.categories.find((entry) => entry.id === id);
  return term ? term.name : 'Story';
}

function ItemMeta(props: { dataset: CmsDataset; item: CmsContentItem }) {
  return (
    <p className="magazine-meta">
      <span className="magazine-kicker">{categoryName(props.dataset, props.item)}</span>
      {props.item.publishedAt ? <time dateTime={props.item.publishedAt}>{formatDate(props.item.publishedAt)}</time> : null}
    </p>
  );
}

export function MagazineCard(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const href = itemHref(props.item);
  return (
    <article className="magazine-card">
      <a className="magazine-card__media" href={href} tabIndex={-1} aria-hidden="true">
        {image
          ? <img src={image} alt="" loading="lazy" decoding="async" />
          : <span className="magazine-card__placeholder" />}
      </a>
      <div className="magazine-card__body">
        <ItemMeta dataset={props.dataset} item={props.item} />
        <h3 className="magazine-card__title"><a href={href}>{props.item.title}</a></h3>
        {props.item.excerpt ? <p className="magazine-card__excerpt">{props.item.excerpt}</p> : null}
      </div>
    </article>
  );
}

export function MagazineHero(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const href = itemHref(props.item);
  return (
    <article className={'magazine-hero' + (image ? ' magazine-hero--image' : '')}>
      {image ? (
        <a className="magazine-hero__media" href={href} tabIndex={-1} aria-hidden="true">
          <img src={image} alt="" decoding="async" />
        </a>
      ) : (
        <div className="magazine-hero__wash" aria-hidden="true" />
      )}
      <div className="magazine-hero__body">
        <ItemMeta dataset={props.dataset} item={props.item} />
        <h2 className="magazine-hero__title"><a href={href}>{props.item.title}</a></h2>
        {props.item.excerpt ? <p className="magazine-hero__excerpt">{props.item.excerpt}</p> : null}
        <a className="magazine-hero__cta" href={href}>Read the story</a>
      </div>
    </article>
  );
}

function CategoryStrip(props: { dataset: CmsDataset }) {
  if (!props.dataset.availability.categories) return null;
  if (!props.dataset.categories.length) return null;
  return (
    <nav className="magazine-topics" aria-label="Categories">
      <span className="magazine-topics__label">Sections</span>
      <ul>
        {props.dataset.categories.slice(0, 10).map((term) => (
          <li key={term.id}>
            <a href={categoryHref(term.slug)}>{term.name}</a>
            {typeof term.count === 'number' ? <span className="magazine-topics__count">{term.count}</span> : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MagazineHome(props: TemplateHomeProps) {
  const posts = homePostsFilter(publishedPosts(props.dataset.posts), props.sections || null);
  const featured = posts[0] || null;
  const rest = posts.slice(1);
  const secondary = rest.slice(0, 3);
  const latest = rest.slice(3, 12);

  return (
    <div className="page magazine-home">
      <h1 className="visually-hidden">Home</h1>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Stories are unavailable" message="The posts index could not be read. This is not an empty site." />
      ) : !featured ? (
        <StateNotice state="empty" title="No published stories yet" message="The catalog loaded successfully and currently contains no published posts." />
      ) : (
        <>
          <MagazineHero dataset={props.dataset} item={featured} />
          <CategoryStrip dataset={props.dataset} />
          {secondary.length > 0 ? (
            <section className="magazine-secondary" aria-labelledby="magazine-secondary-title">
              <div className="magazine-section-head">
                <h2 id="magazine-secondary-title">Top stories</h2>
                <a href="#/posts">All stories</a>
              </div>
              <div className="magazine-secondary__grid">
                {secondary.map((item: CmsContentItem) => <MagazineCard key={item.id} dataset={props.dataset} item={item} />)}
              </div>
            </section>
          ) : null}
          {latest.length > 0 ? (
            <section className="magazine-latest" aria-labelledby="magazine-latest-title">
              <div className="magazine-section-head">
                <h2 id="magazine-latest-title">Latest</h2>
                <a href="#/posts">More stories</a>
              </div>
              <div className="magazine-grid">
                {latest.map((item: CmsContentItem) => <MagazineCard key={item.id} dataset={props.dataset} item={item} />)}
              </div>
            </section>
          ) : null}
          {props.dataset.tags.length > 0 ? (
            <section className="magazine-tags" aria-labelledby="magazine-tags-title">
              <h2 id="magazine-tags-title" className="visually-hidden">Tags</h2>
              <ul className="magazine-tag-list">
                {props.dataset.tags.slice(0, 12).map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function MagazinePosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page magazine-list">
      <div className="magazine-list__head">
        <p className="magazine-kicker">The latest</p>
        <h1>Stories</h1>
      </div>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Stories are unavailable" message="The posts index could not be read from QDN. This is not an empty site." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published stories yet" message="The catalog is readable and contains no published posts." />
      ) : (
        <>
          <div className="magazine-grid">
            {page.items.map((item: CmsContentItem) => <MagazineCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination
            page={page.page}
            totalPages={page.totalPages}
            totalItems={page.totalItems}
            label="Story pages"
            hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')}
          />
        </>
      )}
    </div>
  );
}

export function MagazineTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <div className="page">
        <h1>{isCategory ? 'Categories' : 'Tags'}</h1>
        <StateNotice state="partial" title={(isCategory ? 'Categories' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Category' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page magazine-list">
      <div className="magazine-list__head">
        <p className="magazine-kicker">{isCategory ? 'Section' : 'Topic'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p className="magazine-list__count">{term.count} published</p> : null}
      </div>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Stories are unavailable" message="The posts index could not be read, so this term cannot list its stories." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published stories" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="magazine-grid">
            {page.items.map((item: CmsContentItem) => <MagazineCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Story pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
        </>
      )}
    </div>
  );
}

function taxonomyLinks(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

function ArticleTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = taxonomyLinks(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="article-terms magazine-article__terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="article-terms__heading">Sections</h2>
          <ul className="magazine-tag-list magazine-article__labels">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="article-terms__heading">Topics</h2>
          <ul className="magazine-tag-list magazine-article__labels">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function MagazinePost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow magazine-article magazine-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading story..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow magazine-article magazine-article--state">
        <StateNotice state="error" title="This story could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow magazine-article magazine-article--state">
          <StateNotice state="partial" title="Stories are unavailable" message="The posts index could not be read from QDN. This is not evidence that the story does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Story not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow magazine-article magazine-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading story content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const image = featuredImageUrlForItem(item, props.dataset);
  const title = content.title || item.title;

  return (
    <article className="page magazine-article">
      <header className={'magazine-article__hero' + (image ? ' magazine-article__hero--image' : '')}>
        {image ? (
          <img className="magazine-article__image" src={image} alt={item.featuredImageAlt || item.title} decoding="async" />
        ) : (
          <div className="magazine-article__wash" aria-hidden="true" />
        )}
        <div className="magazine-article__head">
          <p className="eyebrow"><a href="#/posts">Stories</a></p>
          <ItemMeta dataset={props.dataset} item={item} />
          <h1 className="magazine-article__title">{title}</h1>
          {content.author || content.publishedAt ? (
            <p className="magazine-article__byline">
              {content.author ? <span>By {content.author}</span> : null}
              {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
            </p>
          ) : null}
        </div>
      </header>

      <div className="magazine-article__body">
        <PostQuickActions key={item.id} config={props.config || cmsConfig} item={item}><ContentHtml html={content.html} highlightTerms={props.highlightTerms} /></PostQuickActions>
        <ArticleTerms dataset={props.dataset} item={item} />
        {props.previous || props.next ? (
          <nav className="magazine-article__nav" aria-label="Story navigation">
            {props.previous ? (
              <a className="magazine-article__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span className="magazine-kicker">Previous story</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="magazine-article__nav-link magazine-article__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span className="magazine-kicker">Next story</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
        ) : null}
      </div>
    </article>
  );
}

export function MagazinePage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow magazine-page magazine-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow magazine-page magazine-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow magazine-page magazine-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow magazine-page magazine-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page magazine-page">
      <header className="magazine-page__head">
        <p className="magazine-kicker">Page</p>
        <h1>{content.title || item.title}</h1>
        {content.modifiedAt ? <p className="magazine-page__meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>
      <div className="magazine-article__body magazine-page__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      </div>
      {assigned.totalItems > 0 ? (
        <section className="magazine-latest" aria-labelledby="magazine-page-posts-title">
          <div className="magazine-section-head">
            <h2 id="magazine-page-posts-title">Stories</h2>
            <a href="#/posts">All stories</a>
          </div>
          <div className="magazine-grid">
            {assigned.items.map((post: CmsContentItem) => <MagazineCard key={post.id} dataset={props.dataset} item={post} />)}
          </div>
          <Pagination
            page={assigned.page}
            totalPages={assigned.totalPages}
            totalItems={assigned.totalItems}
            label="Page stories"
            hrefForPage={(value: number) => pageHref(item.slug, value)}
          />
        </section>
      ) : null}
    </article>
  );
}

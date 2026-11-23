import { PostQuickActions } from '../components/PostQuickActions';
import type { ReactNode } from 'react';
import { ContentHtml } from '../components/ContentHtml';
import { Pagination } from '../components/Pagination';
import { StateNotice } from '../components/StateNotice';
import { ArchivePage } from '../pages/ArchivePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SearchPage } from '../pages/SearchPage';
import { publishedPosts, paginate, postsForTerm } from '../lib/archive.js';
import { postsForSection } from '../lib/sections.js';
import { categoryHref, tagHref, pageHref, postHref } from '../lib/routes.js';
import { formatDate } from '../lib/text.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset } from '../types';
import type {
  TemplateHomeProps,
  TemplatePostsProps,
  TemplateTermProps,
  TemplatePostProps,
  TemplatePageProps,
  TemplateSearchProps,
  TemplateArchiveProps
} from './types';

interface GuideGroup {
  term: { id: string; name: string; slug: string; count?: number };
  guides: CmsContentItem[];
}

function guideGroups(dataset: CmsDataset) {
  const guides = publishedPosts(dataset.posts);
  const groups: GuideGroup[] = dataset.categories.map((term) => ({
    term,
    guides: guides.filter((guide: CmsContentItem) => guide.categoryIds && guide.categoryIds.includes(term.id))
  }));
  const uncategorized = guides.filter((guide: CmsContentItem) => !guide.categoryIds || guide.categoryIds.length === 0);
  return { guides, groups, uncategorized };
}

function categoryFor(dataset: CmsDataset, item: CmsContentItem) {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function DocsNav(props: { dataset: CmsDataset; activeSlug?: string; activeTerm?: string }) {
  const { guides, groups, uncategorized } = guideGroups(props.dataset);
  return (
    <div className="docs-nav__inner">
      <a className="docs-search-link" href="#/search">
        <span aria-hidden="true">⌕</span> Search documentation
      </a>
      <nav aria-label="Documentation">
        <a
          className="docs-nav__all"
          href="#/posts"
          aria-current={!props.activeSlug && !props.activeTerm ? 'page' : undefined}
        >
          All guides <span>{guides.length}</span>
        </a>
        <ul className="docs-nav__groups">
          {groups.map((group) => (
            <li key={group.term.id}>
              <a
                className="docs-nav__group"
                href={categoryHref(group.term.slug)}
                aria-current={props.activeTerm === group.term.slug ? 'page' : undefined}
              >
                {group.term.name} <span>{group.guides.length}</span>
              </a>
              {group.guides.length > 0 ? (
                <ul className="docs-nav__guides">
                  {group.guides.slice(0, 10).map((guide) => (
                    <li key={guide.id}>
                      <a
                        href={postHref(guide.slug)}
                        aria-current={props.activeSlug === guide.slug ? 'page' : undefined}
                      >
                        {guide.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
          {uncategorized.length > 0 ? (
            <li>
              <span className="docs-nav__group">Other guides <span>{uncategorized.length}</span></span>
              <ul className="docs-nav__guides">
                {uncategorized.slice(0, 10).map((guide) => (
                  <li key={guide.id}>
                    <a href={postHref(guide.slug)} aria-current={props.activeSlug === guide.slug ? 'page' : undefined}>{guide.title}</a>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}

export function DocsShell(props: { dataset: CmsDataset; activeSlug?: string; activeTerm?: string; children: ReactNode }) {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar" aria-label="Documentation navigation">
        <DocsNav dataset={props.dataset} activeSlug={props.activeSlug} activeTerm={props.activeTerm} />
      </aside>
      <details className="docs-menu">
        <summary>Documentation menu</summary>
        <DocsNav dataset={props.dataset} activeSlug={props.activeSlug} activeTerm={props.activeTerm} />
      </details>
      <div className="docs-main">{props.children}</div>
    </div>
  );
}

function GuideList(props: { dataset: CmsDataset; items: CmsContentItem[] }) {
  return (
    <ol className="docs-list">
      {props.items.map((item, index) => {
        const category = categoryFor(props.dataset, item);
        return (
          <li className="docs-list__item" key={item.id}>
            <span className="docs-list__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div className="docs-list__body">
              <p className="docs-meta">
                {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Guide</span>}
                {item.publishedAt ? <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time> : null}
              </p>
              <h3 className="docs-list__title"><a href={postHref(item.slug)}>{item.title}</a></h3>
              {item.excerpt ? <p className="docs-list__excerpt">{item.excerpt}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DocsHome(props: TemplateHomeProps) {
  const { guides, groups } = guideGroups(props.dataset);
  const startHere = guides.slice(0, 4);

  return (
    <div className="page docs-home">
      <h1 className="visually-hidden">Home</h1>
      <section className="docs-hero" aria-labelledby="docs-hero-title">
        <div className="docs-hero__copy">
          <p className="docs-eyebrow">Documentation</p>
          <h2 id="docs-hero-title" className="docs-hero__title">Answers, guides and reference material.</h2>
          <p className="docs-hero__intro">
            {props.dataset.site.description || props.dataset.site.tagline || 'Documentation for the project, published directly from Qortal QDN.'}
          </p>
          <div className="docs-hero__actions">
            <a className="button" href="#/posts">Browse guides</a>
            <a className="button button--ghost" href="#/search">Search documentation</a>
          </div>
        </div>
        <dl className="docs-hero__stats">
          <div><dt>Guides</dt><dd>{guides.length}</dd></div>
          <div><dt>Sections</dt><dd>{groups.length}</dd></div>
        </dl>
      </section>

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Guides are unavailable" message="The posts index could not be read. This is not an empty documentation site." />
      ) : guides.length === 0 ? (
        <StateNotice state="empty" title="No guides yet" message="The catalog loaded successfully and currently contains no published guides." />
      ) : (
        <>
          <section className="docs-home__section" aria-labelledby="docs-categories-title">
            <div className="docs-section-head">
              <p className="docs-eyebrow">Browse by topic</p>
              <h2 id="docs-categories-title">Documentation categories</h2>
            </div>
            <div className="docs-category-grid">
              {groups.map((group) => (
                <a className="docs-category-card" key={group.term.id} href={categoryHref(group.term.slug)}>
                  <span className="docs-category-card__count">{group.guides.length}</span>
                  <strong>{group.term.name}</strong>
                  <span>{group.guides.length === 1 ? '1 guide' : group.guides.length + ' guides'}</span>
                </a>
              ))}
            </div>
          </section>

          <section className="docs-home__section" aria-labelledby="docs-start-title">
            <div className="docs-section-head">
              <p className="docs-eyebrow">Start here</p>
              <h2 id="docs-start-title">Popular starting points</h2>
              <a href="#/posts">All guides</a>
            </div>
            <GuideList dataset={props.dataset} items={startHere} />
          </section>
        </>
      )}
    </div>
  );
}

export function DocsPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <DocsShell dataset={props.dataset}>
      <div className="page docs-index">
        <header className="docs-index__head">
          <p className="docs-eyebrow">Documentation</p>
          <h1>All guides</h1>
          <p>Browse every published guide, tutorial and reference page.</p>
        </header>
        {!props.dataset.availability.posts ? (
          <StateNotice state="partial" title="Guides are unavailable" message="The posts index could not be read from QDN. This is not an empty documentation site." />
        ) : page.totalItems === 0 ? (
          <StateNotice state="empty" title="No guides yet" message="The catalog is readable and contains no published posts." />
        ) : (
          <>
            <GuideList dataset={props.dataset} items={page.items} />
            <Pagination
              page={page.page}
              totalPages={page.totalPages}
              totalItems={page.totalItems}
              label="Guide pages"
              hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')}
            />
          </>
        )}
      </div>
    </DocsShell>
  );
}

export function DocsTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <DocsShell dataset={props.dataset}>
        <div className="page">
          <h1>{isCategory ? 'Categories' : 'Tags'}</h1>
          <StateNotice state="partial" title={(isCategory ? 'Categories' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
        </div>
      </DocsShell>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Category' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <DocsShell dataset={props.dataset} activeTerm={isCategory ? term.slug : undefined}>
      <div className="page docs-index">
        <header className="docs-index__head">
          <p className="docs-eyebrow">{isCategory ? 'Documentation category' : 'Tag'}</p>
          <h1>{term.name}</h1>
          {typeof term.count === 'number' ? <p>{term.count} published</p> : null}
        </header>
        {!props.dataset.availability.posts ? (
          <StateNotice state="partial" title="Guides are unavailable" message="The posts index could not be read, so this term cannot list its guides." />
        ) : page.totalItems === 0 ? (
          <StateNotice state="empty" title="No published guides" message="This term exists, but no published posts reference it." />
        ) : (
          <>
            <GuideList dataset={props.dataset} items={page.items} />
            <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Guide pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
          </>
        )}
      </div>
    </DocsShell>
  );
}

function DocsTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const categories = props.item.categoryIds
    .map((id) => props.dataset.categories.find((term) => term.id === id))
    .filter(Boolean);
  const tags = props.item.tagIds
    .map((id) => props.dataset.tags.find((term) => term.id === id))
    .filter(Boolean);
  if (!categories.length && !tags.length) return null;
  return (
    <footer className="docs-terms">
      {categories.length > 0 ? (
        <div>
          <h2 className="docs-terms__heading">Categories</h2>
          <ul className="docs-tags">
            {categories.map((term) => term ? <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li> : null)}
          </ul>
        </div>
      ) : null}
      {tags.length > 0 ? (
        <div>
          <h2 className="docs-terms__heading">Tags</h2>
          <ul className="docs-tags">
            {tags.map((term) => term ? <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li> : null)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function DocsPost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow docs-article docs-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading guide..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow docs-article docs-article--state">
        <StateNotice state="error" title="This guide could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow docs-article docs-article--state">
          <StateNotice state="partial" title="Guides are unavailable" message="The posts index could not be read from QDN. This is not evidence that the guide does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Guide not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow docs-article docs-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading guide content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const category = categoryFor(props.dataset, item);

  return (
    <DocsShell dataset={props.dataset} activeSlug={item.slug}>
      <article className="page docs-article">
        <header className="docs-article__head">
          <nav className="docs-breadcrumb" aria-label="Breadcrumb">
            <a href="#/posts">Documentation</a>
            <span aria-hidden="true">/</span>
            {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Guide</span>}
          </nav>
          <h1>{content.title || item.title}</h1>
          <p className="docs-meta">
            {category ? <span>{category.name}</span> : null}
            {content.author ? <span>By {content.author}</span> : null}
            {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
            {content.modifiedAt ? <span>Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></span> : null}
          </p>
        </header>

        <div className="docs-article__body">
        <PostQuickActions key={item.id} config={props.config || cmsConfig} item={item}><ContentHtml html={content.html} highlightTerms={props.highlightTerms} /></PostQuickActions>
          <DocsTerms dataset={props.dataset} item={item} />
          <nav className="docs-article__nav" aria-label="Guide navigation">
            {props.previous ? (
              <a className="docs-article__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span>Previous guide</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="docs-article__nav-link docs-article__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span>Next guide</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
          <p className="docs-back"><a href="#/posts">← Back to all guides</a></p>
        </div>
      </article>
    </DocsShell>
  );
}

export function DocsPage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow docs-page docs-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow docs-page docs-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow docs-page docs-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow docs-page docs-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <DocsShell dataset={props.dataset}>
      <article className="page docs-page">
        <header className="docs-index__head">
          <p className="docs-eyebrow">Page</p>
          <h1>{content.title || item.title}</h1>
          {content.modifiedAt ? <p className="docs-meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
        </header>
        <div className="docs-article__body">
          <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
        </div>
        {assigned.totalItems > 0 ? (
          <section className="docs-home__section" aria-labelledby="docs-page-guides-title">
            <div className="docs-section-head">
              <p className="docs-eyebrow">Related</p>
              <h2 id="docs-page-guides-title">Guides on this page</h2>
              <a href="#/posts">All guides</a>
            </div>
            <GuideList dataset={props.dataset} items={assigned.items} />
            <Pagination
              page={assigned.page}
              totalPages={assigned.totalPages}
              totalItems={assigned.totalItems}
              label="Page guides"
              hrefForPage={(value: number) => pageHref(item.slug, value)}
            />
          </section>
        ) : null}
      </article>
    </DocsShell>
  );
}

export function DocsSearch(props: TemplateSearchProps) {
  return (
    <DocsShell dataset={props.dataset}>
      <SearchPage dataset={props.dataset} query={props.query} loadSearchIndex={props.loadSearchIndex} />
    </DocsShell>
  );
}

export function DocsArchive(props: TemplateArchiveProps) {
  return (
    <DocsShell dataset={props.dataset}>
      <ArchivePage dataset={props.dataset} year={props.year} month={props.month} page={props.page} />
    </DocsShell>
  );
}

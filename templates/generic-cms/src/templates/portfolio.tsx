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

function categoryFor(dataset: CmsDataset, item: CmsContentItem): CmsTerm | null {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function categoryName(dataset: CmsDataset, item: CmsContentItem): string {
  const term = categoryFor(dataset, item);
  return term ? term.name : 'Project';
}

function findPublishedPage(dataset: CmsDataset, slug: string): CmsContentItem | null {
  return dataset.pages.find((page) => page.slug === slug && page.status === 'published') || null;
}

function ProjectMeta(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const term = categoryFor(props.dataset, props.item);
  return (
    <p className="portfolio-meta">
      <span className="portfolio-kicker">{term ? term.name : 'Project'}</span>
      {props.item.publishedAt ? <time dateTime={props.item.publishedAt}>{formatDate(props.item.publishedAt)}</time> : null}
    </p>
  );
}

export function PortfolioCard(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const href = postHref(props.item.slug);
  return (
    <article className="portfolio-card">
      <a className="portfolio-card__media" href={href} tabIndex={-1} aria-hidden="true">
        {image
          ? <img src={image} alt="" loading="lazy" decoding="async" />
          : <span className="portfolio-card__placeholder" />}
        <span className="portfolio-card__overlay">View project</span>
      </a>
      <div className="portfolio-card__body">
        <ProjectMeta dataset={props.dataset} item={props.item} />
        <h3 className="portfolio-card__title"><a href={href}>{props.item.title}</a></h3>
        {props.item.excerpt ? <p className="portfolio-card__excerpt">{props.item.excerpt}</p> : null}
      </div>
    </article>
  );
}

function CategoryFilter(props: { dataset: CmsDataset }) {
  if (!props.dataset.availability.categories || !props.dataset.categories.length) return null;
  return (
    <nav className="portfolio-filter" aria-label="Project categories">
      <span className="portfolio-filter__label">Filter</span>
      <ul>
        <li><a href="#/posts">All</a></li>
        {props.dataset.categories.slice(0, 10).map((term) => (
          <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>
        ))}
      </ul>
    </nav>
  );
}

export function PortfolioHome(props: TemplateHomeProps) {
  const posts = homePostsFilter(publishedPosts(props.dataset.posts), props.sections || null);
  const heroProject = posts.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || posts[0] || null;
  const heroImage = heroProject ? featuredImageUrlForItem(heroProject, props.dataset) : '';
  const about = findPublishedPage(props.dataset, 'about');
  const contact = findPublishedPage(props.dataset, 'contact');
  const projectCount = posts.length;

  return (
    <div className="page portfolio-home">
      <h1 className="visually-hidden">Home</h1>

      <section className="portfolio-hero" aria-labelledby="portfolio-hero-title">
        <div className="portfolio-hero__copy">
          <p className="portfolio-eyebrow">Selected portfolio</p>
          <h2 id="portfolio-hero-title" className="portfolio-hero__title">Work worth<br />a closer look.</h2>
          <p className="portfolio-hero__intro">
            {props.dataset.site.description || props.dataset.site.tagline || 'A portfolio of projects, ideas and work in progress.'}
          </p>
          <div className="portfolio-hero__actions">
            <a className="button" href="#/posts">View projects</a>
            {about ? <a className="button button--ghost" href={pageHref(about.slug)}>About</a> : null}
            {contact ? <a className="button button--ghost" href={pageHref(contact.slug)}>Contact</a> : null}
          </div>
          {projectCount > 0 ? <p className="portfolio-hero__count">{[projectCount, 'published projects'].join(' ')}</p> : null}
        </div>
        <div className="portfolio-hero__media">
          {heroImage ? (
            <img src={heroImage} alt={heroProject && heroProject.featuredImageAlt || ''} decoding="async" />
          ) : (
            <div className="portfolio-hero__placeholder" aria-hidden="true" />
          )}
          {heroProject ? (
            <a className="portfolio-hero__caption" href={postHref(heroProject.slug)}>
              <span>Featured project</span>
              <strong>{heroProject.title}</strong>
            </a>
          ) : null}
        </div>
      </section>

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read. This is not an empty portfolio." />
      ) : posts.length === 0 ? (
        <StateNotice state="empty" title="No projects yet" message="The catalog loaded successfully and currently contains no published projects." />
      ) : (
        <section className="portfolio-work" aria-labelledby="portfolio-work-title">
          <div className="portfolio-section-head">
            <span className="portfolio-index">01</span>
            <h2 id="portfolio-work-title">Selected work</h2>
            <a href="#/posts">All projects</a>
          </div>
          <CategoryFilter dataset={props.dataset} />
          <div className="portfolio-grid">
            {posts.slice(0, 6).map((item: CmsContentItem) => <PortfolioCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
        </section>
      )}

      <section className="portfolio-about" aria-labelledby="portfolio-about-title">
        <span className="portfolio-index">02</span>
        <div>
          <h2 id="portfolio-about-title">{about ? about.title : 'About'}</h2>
          <p>{about && about.excerpt ? about.excerpt : (props.dataset.site.description || props.dataset.site.tagline || 'This portfolio is published directly from Qortal QDN.')}</p>
          {about ? <a className="button button--ghost" href={pageHref(about.slug)}>More about me</a> : null}
        </div>
      </section>

      <section className="portfolio-contact" aria-labelledby="portfolio-contact-title">
        <span className="portfolio-index">03</span>
        <div>
          <h2 id="portfolio-contact-title">Let’s make something.</h2>
          <p>{contact && contact.excerpt ? contact.excerpt : 'Open to new projects, collaborations and interesting ideas.'}</p>
          {contact ? <a className="button" href={pageHref(contact.slug)}>Get in touch</a> : <a className="button" href="#/posts">See the work</a>}
        </div>
      </section>
    </div>
  );
}

export function PortfolioPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page portfolio-list">
      <header className="portfolio-list__head">
        <p className="portfolio-eyebrow">Projects</p>
        <h1>Selected work</h1>
        <p>A growing collection of projects, experiments and collaborations.</p>
      </header>
      <CategoryFilter dataset={props.dataset} />
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read from QDN. This is not an empty portfolio." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No projects yet" message="The catalog is readable and contains no published projects." />
      ) : (
        <>
          <div className="portfolio-grid">
            {page.items.map((item: CmsContentItem) => <PortfolioCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination
            page={page.page}
            totalPages={page.totalPages}
            totalItems={page.totalItems}
            label="Project pages"
            hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')}
          />
        </>
      )}
    </div>
  );
}

export function PortfolioTerm(props: TemplateTermProps) {
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
    <div className="page portfolio-list">
      <header className="portfolio-list__head">
        <p className="portfolio-eyebrow">{isCategory ? 'Project category' : 'Project topic'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p>{term.count} published</p> : null}
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read, so this term cannot list its projects." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published projects" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="portfolio-grid">
            {page.items.map((item: CmsContentItem) => <PortfolioCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Project pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
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

function ProjectTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = taxonomyLinks(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="portfolio-terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="portfolio-terms__heading">Categories</h2>
          <ul className="portfolio-tags">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="portfolio-terms__heading">Topics</h2>
          <ul className="portfolio-tags">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function PortfolioPost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow portfolio-project portfolio-project--state" aria-busy="true">
        <StateNotice state="loading" title="Loading project..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow portfolio-project portfolio-project--state">
        <StateNotice state="error" title="This project could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow portfolio-project portfolio-project--state">
          <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read from QDN. This is not evidence that the project does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Project not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow portfolio-project portfolio-project--state" aria-busy="true">
        <StateNotice state="loading" title="Loading project content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const image = featuredImageUrlForItem(item, props.dataset);
  const title = content.title || item.title;

  return (
    <article className="page portfolio-project">
      <header className={'portfolio-project__hero' + (image ? ' portfolio-project__hero--image' : '')}>
        <div className="portfolio-project__intro">
          <p className="portfolio-eyebrow"><a href="#/posts">Projects</a></p>
          <ProjectMeta dataset={props.dataset} item={item} />
          <h1 className="portfolio-project__title">{title}</h1>
          {content.author ? <p className="portfolio-project__byline">By {content.author}</p> : null}
        </div>
        <div className="portfolio-project__media">
          {image
            ? <img src={image} alt={item.featuredImageAlt || item.title} decoding="async" />
            : <div className="portfolio-project__placeholder" aria-hidden="true" />}
        </div>
      </header>

      <div className="portfolio-project__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
        <ProjectTerms dataset={props.dataset} item={item} />
        {props.previous || props.next ? (
          <nav className="portfolio-project__nav" aria-label="Project navigation">
            {props.previous ? (
              <a className="portfolio-project__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span className="portfolio-kicker">Previous project</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="portfolio-project__nav-link portfolio-project__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span className="portfolio-kicker">Next project</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
        ) : null}
      </div>
    </article>
  );
}

export function PortfolioPage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow portfolio-page portfolio-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow portfolio-page portfolio-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow portfolio-page portfolio-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow portfolio-page portfolio-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page portfolio-page">
      <header className="portfolio-page__head">
        <p className="portfolio-eyebrow">Page</p>
        <h1>{content.title || item.title}</h1>
        {content.modifiedAt ? <p className="portfolio-page__meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>
      <div className="portfolio-page__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      </div>
      {assigned.totalItems > 0 ? (
        <section className="portfolio-work" aria-labelledby="portfolio-page-projects-title">
          <div className="portfolio-section-head">
            <span className="portfolio-index">+</span>
            <h2 id="portfolio-page-projects-title">More projects</h2>
            <a href="#/posts">All projects</a>
          </div>
          <div className="portfolio-grid">
            {assigned.items.map((post: CmsContentItem) => <PortfolioCard key={post.id} dataset={props.dataset} item={post} />)}
          </div>
          <Pagination
            page={assigned.page}
            totalPages={assigned.totalPages}
            totalItems={assigned.totalItems}
            label="Page projects"
            hrefForPage={(value: number) => pageHref(item.slug, value)}
          />
        </section>
      ) : null}
    </article>
  );
}

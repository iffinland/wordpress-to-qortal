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
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, CmsTerm } from '../types';
import type { TemplateHomeProps, TemplatePostsProps, TemplateTermProps, TemplatePostProps, TemplatePageProps } from './types';

interface ServiceEntry {
  key: string;
  title: string;
  excerpt: string;
  image: string;
  href: string;
  label: string;
}

function findPage(dataset: CmsDataset, slug: string): CmsContentItem | null {
  return dataset.pages.find((page) => page.slug === slug && page.status === 'published') || null;
}

function categoryFor(dataset: CmsDataset, item: CmsContentItem): CmsTerm | null {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function serviceEntries(dataset: CmsDataset): ServiceEntry[] {
  const pages = dataset.pages
    .filter((page) => page.status === 'published' && page.slug !== 'about' && page.slug !== 'contact')
    .map((page) => ({
      key: page.id,
      title: page.title,
      excerpt: page.excerpt || '',
      image: featuredImageUrlForItem(page, dataset),
      href: pageHref(page.slug),
      label: 'Service'
    }));
  if (pages.length) return pages;

  const projects = publishedPosts(dataset.posts);
  return dataset.categories.map((term) => {
    const entries = projects.filter((item: CmsContentItem) => item.categoryIds && item.categoryIds.includes(term.id));
    const cover = entries.find((item: CmsContentItem) => featuredImageUrlForItem(item, dataset)) || null;
    return {
      key: term.id,
      title: term.name,
      excerpt: entries.length ? (entries.length === 1 ? '1 completed project' : entries.length + ' completed projects') : 'Explore this service area.',
      image: cover ? featuredImageUrlForItem(cover, dataset) : '',
      href: categoryHref(term.slug),
      label: 'Service area'
    };
  });
}

function BusinessProjectCard(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  const category = categoryFor(props.dataset, props.item);
  return (
    <article className="business-project-card">
      <a className="business-project-card__media" href={postHref(props.item.slug)} tabIndex={-1} aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="business-project-card__placeholder" />}
      </a>
      <div className="business-project-card__body">
        <p className="business-meta">
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Project</span>}
          {props.item.publishedAt ? <time dateTime={props.item.publishedAt}>{formatDate(props.item.publishedAt)}</time> : null}
        </p>
        <h3><a href={postHref(props.item.slug)}>{props.item.title}</a></h3>
        {props.item.excerpt ? <p>{props.item.excerpt}</p> : null}
      </div>
    </article>
  );
}

function BusinessServiceCard(props: { service: ServiceEntry; index: number }) {
  return (
    <a className="business-service-card" href={props.service.href}>
      <div className="business-service-card__media">
        {props.service.image
          ? <img src={props.service.image} alt="" loading="lazy" decoding="async" />
          : <span className="business-service-card__placeholder" />}
      </div>
      <div className="business-service-card__body">
        <span className="business-service-card__index" aria-hidden="true">{String(props.index + 1).padStart(2, '0')}</span>
        <p className="business-service-card__label">{props.service.label}</p>
        <h3>{props.service.title}</h3>
        {props.service.excerpt ? <p>{props.service.excerpt}</p> : null}
        <span className="business-service-card__more">Learn more →</span>
      </div>
    </a>
  );
}

export function BusinessHome(props: TemplateHomeProps) {
  const posts = publishedPosts(props.dataset.posts);
  const services = serviceEntries(props.dataset);
  const about = findPage(props.dataset, 'about');
  const contact = findPage(props.dataset, 'contact');
  const heroItem = posts.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset))
    || (about && featuredImageUrlForItem(about, props.dataset) ? about : null)
    || posts[0]
    || null;
  const heroImage = heroItem ? featuredImageUrlForItem(heroItem, props.dataset) : '';
  const aboutImage = about ? featuredImageUrlForItem(about, props.dataset) : '';
  const contactHref = contact ? pageHref(contact.slug) : '#/posts';

  return (
    <div className="page business-home">
      <h1 className="visually-hidden">Home</h1>

      <section className="business-hero" aria-labelledby="business-hero-title">
        <div className="business-hero__copy">
          <p className="business-eyebrow">Business / Services</p>
          <h2 id="business-hero-title" className="business-hero__title">
            {props.dataset.site.tagline || 'Practical expertise for growing teams.'}
          </h2>
          <p className="business-hero__intro">
            {props.dataset.site.description || 'Professional services delivered with clarity, care and measurable results.'}
          </p>
          <div className="business-hero__actions">
            <a className="button" href="#/posts">View our work</a>
            <a className="button button--ghost" href={contactHref}>Contact us</a>
          </div>
        </div>
        <div className="business-hero__media">
          {heroImage ? <img src={heroImage} alt={heroItem ? heroItem.title : ''} decoding="async" /> : <div className="business-hero__placeholder" aria-hidden="true" />}
        </div>
      </section>

      {services.length > 0 ? (
        <section className="business-services" aria-labelledby="business-services-title">
          <div className="business-section-head">
            <div>
              <p className="business-eyebrow">What we do</p>
              <h2 id="business-services-title">Services</h2>
            </div>
            <p>Focused support for the work that matters most.</p>
          </div>
          <div className="business-service-grid">
            {services.map((service, index) => <BusinessServiceCard key={service.key} service={service} index={index} />)}
          </div>
        </section>
      ) : null}

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read. This is not an empty portfolio." />
      ) : posts.length > 0 ? (
        <section className="business-projects" aria-labelledby="business-projects-title">
          <div className="business-section-head">
            <div>
              <p className="business-eyebrow">Selected work</p>
              <h2 id="business-projects-title">Completed projects</h2>
            </div>
            <a href="#/posts">All projects</a>
          </div>
          <div className="business-project-grid">
            {posts.slice(0, 3).map((item: CmsContentItem) => <BusinessProjectCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
        </section>
      ) : null}

      <section className="business-about" aria-labelledby="business-about-title">
        <div className="business-about__copy">
          <p className="business-eyebrow">About</p>
          <h2 id="business-about-title">{about ? about.title : 'Our approach'}</h2>
          <p>{about && about.excerpt ? about.excerpt : (props.dataset.site.description || 'A small team focused on thoughtful, practical work.')}</p>
          {about ? <a className="button button--ghost" href={pageHref(about.slug)}>More about us</a> : null}
        </div>
        {aboutImage ? <img className="business-about__image" src={aboutImage} alt={about ? about.title : ''} loading="lazy" decoding="async" /> : null}
      </section>

      <section className="business-contact" aria-labelledby="business-contact-title">
        <div>
          <p className="business-eyebrow">Contact</p>
          <h2 id="business-contact-title">Let’s talk about your next project.</h2>
          <p>{contact && contact.excerpt ? contact.excerpt : 'Tell us what you are working on and we will help you find the next step.'}</p>
        </div>
        <a className="button" href={contactHref}>{contact ? 'Get in touch' : 'See our work'}</a>
      </section>
    </div>
  );
}

export function BusinessPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page business-index">
      <header className="business-index__head">
        <p className="business-eyebrow">Completed projects</p>
        <h1>Our work</h1>
        <p>Selected projects, case studies and client outcomes.</p>
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read from QDN. This is not an empty portfolio." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No projects yet" message="The catalog is readable and contains no published projects." />
      ) : (
        <>
          <div className="business-project-grid">
            {page.items.map((item: CmsContentItem) => <BusinessProjectCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Project pages" hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')} />
        </>
      )}
    </div>
  );
}

export function BusinessTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <div className="page business-index">
        <h1>{isCategory ? 'Services' : 'Tags'}</h1>
        <StateNotice state="partial" title={(isCategory ? 'Services' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Service' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page business-index">
      <header className="business-index__head">
        <p className="business-eyebrow">{isCategory ? 'Service area' : 'Tag'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p>{term.count} completed projects</p> : null}
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read, so this service area cannot list its projects." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published projects" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="business-project-grid">
            {page.items.map((item: CmsContentItem) => <BusinessProjectCard key={item.id} dataset={props.dataset} item={item} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Project pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
        </>
      )}
    </div>
  );
}

function businessTaxonomy(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

function BusinessTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = businessTaxonomy(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="business-article__terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="business-terms__heading">Services</h2>
          <ul className="business-tags">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="business-terms__heading">Tags</h2>
          <ul className="business-tags">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function BusinessPost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow business-article business-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading project..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow business-article business-article--state">
        <StateNotice state="error" title="This project could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow business-article business-article--state">
          <StateNotice state="partial" title="Projects are unavailable" message="The posts index could not be read from QDN. This is not evidence that the project does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Project not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow business-article business-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading project content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const image = featuredImageUrlForItem(item, props.dataset);
  const category = categoryFor(props.dataset, item);
  const title = content.title || item.title;

  return (
    <article className="page business-article">
      <header className="business-article__head">
        <nav className="business-breadcrumb" aria-label="Breadcrumb">
          <a href="#/posts">Projects</a>
          <span aria-hidden="true">/</span>
          {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Project</span>}
        </nav>
        <h1>{title}</h1>
        <p className="business-meta business-article__byline">
          {content.author ? <span>By {content.author}</span> : null}
          {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
          {content.modifiedAt ? <span>Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></span> : null}
        </p>
      </header>
      {image ? <img className="business-article__image" src={image} alt={item.featuredImageAlt || item.title} decoding="async" /> : null}
      <div className="business-article__body">
        <PostQuickActions key={item.id} config={props.config || cmsConfig} item={item}><ContentHtml html={content.html} highlightTerms={props.highlightTerms} /></PostQuickActions>
        <BusinessTerms dataset={props.dataset} item={item} />
        {props.previous || props.next ? (
          <nav className="business-article__nav" aria-label="Project navigation">
            {props.previous ? (
              <a className="business-article__nav-link" href={postHref(props.previous.slug)} rel="prev">
                <span>Previous project</span>
                <strong>{props.previous.title}</strong>
              </a>
            ) : <span />}
            {props.next ? (
              <a className="business-article__nav-link business-article__nav-link--next" href={postHref(props.next.slug)} rel="next">
                <span>Next project</span>
                <strong>{props.next.title}</strong>
              </a>
            ) : null}
          </nav>
        ) : null}
        <p className="business-back"><a href="#/posts">← Back to projects</a></p>
      </div>
    </article>
  );
}

export function BusinessPage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow business-page business-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow business-page business-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow business-page business-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow business-page business-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const contact = findPage(props.dataset, 'contact');
  const showContact = Boolean(contact && item.slug !== 'contact');
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page business-page">
      <header className="business-page__head">
        <p className="business-eyebrow">{item.slug === 'contact' ? 'Contact' : item.slug === 'about' ? 'About' : 'Service'}</p>
        <h1>{content.title || item.title}</h1>
        {item.excerpt ? <p className="business-page__lead">{item.excerpt}</p> : null}
        {content.modifiedAt ? <p className="business-meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>

      <div className={'business-page__layout' + (showContact ? ' business-page__layout--with-aside' : '')}>
        <div className="business-page__body">
          <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
        </div>
        {showContact ? (
          <aside className="business-page__aside" aria-label="Contact">
            <p className="business-eyebrow">Next step</p>
            <h2>Ready to talk?</h2>
            <p>{contact && contact.excerpt ? contact.excerpt : 'Tell us about your project and we will get back to you.'}</p>
            <a className="button" href={pageHref(contact!.slug)}>Contact us</a>
          </aside>
        ) : null}
      </div>

      {assigned.totalItems > 0 ? (
        <section className="business-projects" aria-labelledby="business-page-projects-title">
          <div className="business-section-head">
            <div>
              <p className="business-eyebrow">Related</p>
              <h2 id="business-page-projects-title">Projects on this page</h2>
            </div>
            <a href="#/posts">All projects</a>
          </div>
          <div className="business-project-grid">
            {assigned.items.map((post: CmsContentItem) => <BusinessProjectCard key={post.id} dataset={props.dataset} item={post} />)}
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

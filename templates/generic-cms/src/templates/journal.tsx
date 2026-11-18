import { ContentHtml } from '../components/ContentHtml';
import { Pagination } from '../components/Pagination';
import { StateNotice } from '../components/StateNotice';
import { ArchivePage } from '../pages/ArchivePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { publishedPosts, paginate, postsForTerm } from '../lib/archive.js';
import { postsForSection } from '../lib/sections.js';
import { categoryHref, tagHref, pageHref, postHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import { formatDate, formatMonth } from '../lib/text.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, CmsTerm } from '../types';
import type { TemplateHomeProps, TemplatePostsProps, TemplateTermProps, TemplatePostProps, TemplatePageProps, TemplateArchiveProps } from './types';

function entryDate(item: CmsContentItem): string {
  return item.publishedAt || item.createdAt || '';
}

function categoryFor(dataset: CmsDataset, item: CmsContentItem): CmsTerm | null {
  if (!item.categoryIds || !item.categoryIds.length) return null;
  return dataset.categories.find((term) => term.id === item.categoryIds[0]) || null;
}

function groupByMonth(items: CmsContentItem[]) {
  const years = new Map<number, Map<number, CmsContentItem[]>>();
  for (const item of items) {
    const value = entryDate(item);
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year)!;
    months.set(month, [...(months.get(month) || []), item]);
  }
  return [...years.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([month, entries]) => ({ month, entries }))
    }));
}

function EntryMeta(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const category = categoryFor(props.dataset, props.item);
  return (
    <p className="journal-meta">
      {category ? <a href={categoryHref(category.slug)}>{category.name}</a> : <span>Journal</span>}
      {entryDate(props.item) ? <time dateTime={entryDate(props.item)}>{formatDate(entryDate(props.item))}</time> : null}
    </p>
  );
}

function JournalTimeline(props: { dataset: CmsDataset; items: CmsContentItem[] }) {
  const groups = groupByMonth(props.items);
  return (
    <div className="journal-timeline">
      {groups.map((group) => (
        <section className="journal-year" key={group.year}>
          <h3 className="journal-year__title">{group.year}</h3>
          {group.months.map((month) => (
            <div className="journal-month" key={group.year + '-' + month.month}>
              <h4 className="journal-month__title">{formatMonth(group.year, month.month)}</h4>
              <ol className="journal-entries">
                {month.entries.map((item) => (
                  <li className="journal-entry" key={item.id}>
                    <time className="journal-entry__date" dateTime={entryDate(item)}>
                      {formatDate(entryDate(item), { month: 'short', day: 'numeric', year: undefined })}
                    </time>
                    <div className="journal-entry__body">
                      <EntryMeta dataset={props.dataset} item={item} />
                      <h5 className="journal-entry__title"><a href={postHref(item.slug)}>{item.title}</a></h5>
                      {item.excerpt ? <p className="journal-entry__excerpt">{item.excerpt}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function RecentEntry(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const image = featuredImageUrlForItem(props.item, props.dataset);
  return (
    <article className="journal-recent-card">
      {image ? (
        <a className="journal-recent-card__media" href={postHref(props.item.slug)} tabIndex={-1} aria-hidden="true">
          <img src={image} alt="" loading="lazy" decoding="async" />
        </a>
      ) : null}
      <div className="journal-recent-card__body">
        <EntryMeta dataset={props.dataset} item={props.item} />
        <h3><a href={postHref(props.item.slug)}>{props.item.title}</a></h3>
        {props.item.excerpt ? <p>{props.item.excerpt}</p> : null}
        <a className="journal-read-more" href={postHref(props.item.slug)}>Continue reading →</a>
      </div>
    </article>
  );
}

export function JournalHome(props: TemplateHomeProps) {
  const posts = publishedPosts(props.dataset.posts);
  const featured = posts.find((item: CmsContentItem) => featuredImageUrlForItem(item, props.dataset)) || posts[0] || null;
  const image = featured ? featuredImageUrlForItem(featured, props.dataset) : '';
  const recent = posts.slice(0, 3);
  const timeline = posts.slice(0, 12);

  return (
    <div className="page journal-home">
      <h1 className="visually-hidden">Home</h1>

      <section className="journal-hero" aria-labelledby="journal-hero-title">
        <div className="journal-hero__copy">
          <p className="journal-eyebrow">A personal journal</p>
          <h2 id="journal-hero-title">{props.dataset.site.tagline || 'Notes on life, place and the everyday.'}</h2>
          <p className="journal-hero__intro">
            {props.dataset.site.description || 'Reflections, travel notes and small observations, kept in one quiet place.'}
          </p>
          <div className="journal-hero__actions">
            <a className="button" href="#/posts">Read the journal</a>
            <a className="button button--ghost" href="#/archive">Archive</a>
          </div>
        </div>
        <div className="journal-hero__media">
          {image ? <img src={image} alt={featured ? featured.title : ''} decoding="async" /> : <div className="journal-hero__placeholder" aria-hidden="true" />}
          {featured ? (
            <a className="journal-hero__caption" href={postHref(featured.slug)}>
              <span>Latest entry</span>
              <strong>{featured.title}</strong>
            </a>
          ) : null}
        </div>
      </section>

      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Journal entries are unavailable" message="The posts index could not be read. This is not an empty journal." />
      ) : posts.length === 0 ? (
        <StateNotice state="empty" title="No entries yet" message="The catalog loaded successfully and currently contains no published journal entries." />
      ) : (
        <>
          <section className="journal-recent" aria-labelledby="journal-recent-title">
            <div className="journal-section-head">
              <p className="journal-eyebrow">Recently</p>
              <h2 id="journal-recent-title">Recent entries</h2>
              <a href="#/posts">All entries</a>
            </div>
            <div className="journal-recent-list">
              {recent.map((item: CmsContentItem) => <RecentEntry key={item.id} dataset={props.dataset} item={item} />)}
            </div>
          </section>

          <section className="journal-timeline-section" aria-labelledby="journal-timeline-title">
            <div className="journal-section-head">
              <p className="journal-eyebrow">Chronology</p>
              <h2 id="journal-timeline-title">Journal timeline</h2>
              <a href="#/archive">Archive</a>
            </div>
            <JournalTimeline dataset={props.dataset} items={timeline} />
          </section>

          <section className="journal-topics" aria-label="Journal topics">
            <div>
              <h2>Topics</h2>
              {props.dataset.categories.length ? (
                <ul className="journal-topic-list">
                  {props.dataset.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
                </ul>
              ) : <p className="muted">No topics yet.</p>}
            </div>
            <div>
              <h2>Places &amp; themes</h2>
              {props.dataset.tags.length ? (
                <ul className="journal-topic-list">
                  {props.dataset.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
                </ul>
              ) : <p className="muted">No tags yet.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function JournalPosts(props: TemplatePostsProps) {
  const page = paginate(publishedPosts(props.dataset.posts), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page journal-index">
      <header className="journal-index__head">
        <p className="journal-eyebrow">The journal</p>
        <h1>Entries</h1>
        <p>Stories, notes and reflections in chronological order.</p>
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Journal entries are unavailable" message="The posts index could not be read from QDN. This is not an empty journal." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No entries yet" message="The catalog is readable and contains no published entries." />
      ) : (
        <>
          <JournalTimeline dataset={props.dataset} items={page.items} />
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Journal pages" hrefForPage={(value) => (value > 1 ? '#/posts?page=' + value : '#/posts')} />
        </>
      )}
    </div>
  );
}

export function JournalTerm(props: TemplateTermProps) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <div className="page journal-index">
        <h1>{isCategory ? 'Topics' : 'Tags'}</h1>
        <StateNotice state="partial" title={(isCategory ? 'Topics' : 'Tags') + ' are unavailable'} message="The taxonomy index could not be read from QDN. This is not an empty result." />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) return <NotFoundPage title={(isCategory ? 'Topic' : 'Tag') + ' not found'} message="No published term matches this address." />;
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  return (
    <div className="page journal-index">
      <header className="journal-index__head">
        <p className="journal-eyebrow">{isCategory ? 'Topic' : 'Tag'}</p>
        <h1>{term.name}</h1>
        {typeof term.count === 'number' ? <p>{term.count} {term.count === 1 ? 'entry' : 'entries'}</p> : null}
      </header>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Journal entries are unavailable" message="The posts index could not be read, so this topic cannot list its entries." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published entries" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <JournalTimeline dataset={props.dataset} items={page.items} />
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Journal pages" hrefForPage={(value) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value))} />
        </>
      )}
    </div>
  );
}

function journalTaxonomy(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

function JournalTerms(props: { dataset: CmsDataset; item: CmsContentItem }) {
  const terms = journalTaxonomy(props.dataset, props.item);
  if (!terms.categories.length && !terms.tags.length) return null;
  return (
    <footer className="journal-article__terms">
      {terms.categories.length > 0 ? (
        <div>
          <h2 className="journal-terms__heading">Topics</h2>
          <ul className="journal-tags">
            {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
      {terms.tags.length > 0 ? (
        <div>
          <h2 className="journal-terms__heading">Places &amp; themes</h2>
          <ul className="journal-tags">
            {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

export function JournalPost(props: TemplatePostProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow journal-article journal-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading entry..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow journal-article journal-article--state">
        <StateNotice state="error" title="This entry could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow journal-article journal-article--state">
          <StateNotice state="partial" title="Journal entries are unavailable" message="The posts index could not be read from QDN. This is not evidence that the entry does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Entry not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow journal-article journal-article--state" aria-busy="true">
        <StateNotice state="loading" title="Loading entry content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const image = featuredImageUrlForItem(item, props.dataset);

  return (
    <article className="page journal-article">
      {image ? <img className="journal-article__image" src={image} alt={item.featuredImageAlt || item.title} decoding="async" /> : null}
      <header className="journal-article__head">
        <EntryMeta dataset={props.dataset} item={item} />
        <h1>{content.title || item.title}</h1>
        {content.author ? <p className="journal-article__byline">By {content.author}</p> : null}
      </header>
      <div className="journal-article__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      </div>
      <JournalTerms dataset={props.dataset} item={item} />
      {props.previous || props.next ? (
        <nav className="journal-article__nav" aria-label="Journal navigation">
          {props.previous ? (
            <a className="journal-article__nav-link" href={postHref(props.previous.slug)} rel="prev">
              <span>Previous entry</span>
              <strong>{props.previous.title}</strong>
            </a>
          ) : <span />}
          {props.next ? (
            <a className="journal-article__nav-link journal-article__nav-link--next" href={postHref(props.next.slug)} rel="next">
              <span>Next entry</span>
              <strong>{props.next.title}</strong>
            </a>
          ) : null}
        </nav>
      ) : null}
      <p className="journal-back"><a href="#/posts">← Back to the journal</a></p>
    </article>
  );
}

export function JournalPage(props: TemplatePageProps) {
  if (props.loading) {
    return (
      <div className="page page--narrow journal-page journal-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow journal-page journal-page--state">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow journal-page journal-page--state">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow journal-page journal-page--state" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);

  return (
    <article className="page journal-page">
      <header className="journal-article__head">
        <p className="journal-eyebrow">Page</p>
        <h1>{content.title || item.title}</h1>
        {content.modifiedAt ? <p className="journal-meta">Updated <time dateTime={content.modifiedAt}>{formatDate(content.modifiedAt)}</time></p> : null}
      </header>
      <div className="journal-article__body">
        <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      </div>
      {assigned.totalItems > 0 ? (
        <section className="journal-recent" aria-labelledby="journal-page-entries-title">
          <div className="journal-section-head">
            <p className="journal-eyebrow">Related</p>
            <h2 id="journal-page-entries-title">Entries on this page</h2>
            <a href="#/posts">All entries</a>
          </div>
          <div className="journal-recent-list">
            {assigned.items.map((post: CmsContentItem) => <RecentEntry key={post.id} dataset={props.dataset} item={post} />)}
          </div>
          <Pagination page={assigned.page} totalPages={assigned.totalPages} totalItems={assigned.totalItems} label="Page entries" hrefForPage={(value: number) => pageHref(item.slug, value)} />
        </section>
      ) : null}
    </article>
  );
}

export function JournalArchive(props: TemplateArchiveProps) {
  return (
    <div className="journal-archive">
      <ArchivePage dataset={props.dataset} year={props.year} month={props.month} page={props.page} />
    </div>
  );
}

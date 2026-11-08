import { ContentHtml } from '../components/ContentHtml';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from './NotFoundPage';
import { categoryHref, tagHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import { formatDate } from '../lib/text.js';
import type { CmsContentItem, CmsDataset, CmsTerm, LoadedContent } from '../types';

function taxonomyLinks(dataset: CmsDataset, item: CmsContentItem) {
  const categories = item.categoryIds
    .map((id) => dataset.categories.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  const tags = item.tagIds
    .map((id) => dataset.tags.find((term) => term.id === id))
    .filter((term): term is CmsTerm => Boolean(term));
  return { categories, tags };
}

export function PostPage(props: {
  dataset: CmsDataset;
  item: CmsContentItem | null;
  content: LoadedContent | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  previous: CmsContentItem | null;
  next: CmsContentItem | null;
  highlightTerms?: string[];
}) {
  if (props.loading) {
    return (
      <div className="page page--narrow" aria-busy="true">
        <StateNotice state="loading" title="Loading post..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow">
        <StateNotice state="error" title="This post could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.posts) {
      return (
        <div className="page page--narrow">
          <StateNotice state="partial" title="Posts are unavailable" message="The posts index could not be read from QDN. This is not evidence that the post does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Post not found" message="No published post with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow" aria-busy="true">
        <StateNotice state="loading" title="Loading post content..." />
      </div>
    );
  }

  const item = props.item;
  const content = props.content;
  const terms = taxonomyLinks(props.dataset, item);
  const image = featuredImageUrlForItem(item, props.dataset);

  return (
    <article className="page page--article">
      <p className="eyebrow"><a href="#/posts">Posts</a></p>
      <h1>{content.title || item.title}</h1>
      <p className="article-meta">
        {content.publishedAt ? <time dateTime={content.publishedAt}>{formatDate(content.publishedAt)}</time> : null}
        {content.author ? <span>By {content.author}</span> : null}
      </p>
      {image ? <img className="article-image" src={image} alt={item.title} loading="lazy" decoding="async" /> : null}
      <ContentHtml html={content.html} highlightTerms={props.highlightTerms} />
      {terms.categories.length > 0 || terms.tags.length > 0 ? (
        <footer className="article-terms">
          {terms.categories.length > 0 ? (
            <div>
              <h2 className="article-terms__heading">Categories</h2>
              <ul className="term-list term-list--inline">
                {terms.categories.map((term) => <li key={term.id}><a href={categoryHref(term.slug)}>{term.name}</a></li>)}
              </ul>
            </div>
          ) : null}
          {terms.tags.length > 0 ? (
            <div>
              <h2 className="article-terms__heading">Tags</h2>
              <ul className="term-list term-list--inline">
                {terms.tags.map((term) => <li key={term.id}><a href={tagHref(term.slug)}>{term.name}</a></li>)}
              </ul>
            </div>
          ) : null}
        </footer>
      ) : null}
      {props.previous || props.next ? (
        <nav className="article-nav" aria-label="Post navigation">
          {props.previous ? <a className="button button--ghost" href={'#/posts/' + encodeURIComponent(props.previous.slug)} rel="prev">Previous: {props.previous.title}</a> : null}
          {props.next ? <a className="button button--ghost" href={'#/posts/' + encodeURIComponent(props.next.slug)} rel="next">Next: {props.next.title}</a> : null}
        </nav>
      ) : null}
    </article>
  );
}

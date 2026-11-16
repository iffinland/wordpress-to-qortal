import { ContentHtml } from '../components/ContentHtml';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from './NotFoundPage';
import { formatDate } from '../lib/text.js';
import { Pagination } from '../components/Pagination';
import { PostCard } from '../components/PostCard';
import { paginate } from '../lib/archive.js';
import { postsForSection } from '../lib/sections.js';
import { pageHref } from '../lib/routes.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset, LoadedContent, SectionsDocument } from '../types';

export function PageView(props: {
  dataset: CmsDataset;
  item: CmsContentItem | null;
  content: LoadedContent | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  highlightTerms?: string[];
  sections?: SectionsDocument | null;
  pageNumber?: number;
}) {
  if (props.loading) {
    return (
      <div className="page page--narrow" aria-busy="true">
        <StateNotice state="loading" title="Loading page..." message="Fetching the exact content resource from QDN." />
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="page page--narrow">
        <StateNotice state="error" title="This page could not be loaded" message={props.error} />
        <button type="button" className="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.item) {
    if (!props.dataset.availability.pages) {
      return (
        <div className="page page--narrow">
          <StateNotice state="partial" title="Pages are unavailable" message="The pages index could not be read from QDN. This is not evidence that the page does not exist." />
        </div>
      );
    }
    return <NotFoundPage title="Page not found" message="No published page with this slug exists in the current catalog." />;
  }
  if (!props.content) {
    return (
      <div className="page page--narrow" aria-busy="true">
        <StateNotice state="loading" title="Loading page content..." />
      </div>
    );
  }
  const assigned = paginate(postsForSection(props.dataset.posts, props.sections || null, props.item.slug), props.pageNumber || 1, cmsConfig.content.pageSize);
  return (
    <article className="page page--article">
      <p className="eyebrow">Page</p>
      <h1>{props.content.title || props.item.title}</h1>
      {props.content.modifiedAt ? <p className="article-meta">Updated <time dateTime={props.content.modifiedAt}>{formatDate(props.content.modifiedAt)}</time></p> : null}
      <ContentHtml html={props.content.html} highlightTerms={props.highlightTerms} />
      {assigned.totalItems > 0 ? (
        <section className="section" aria-labelledby="page-posts-title">
          <h2 id="page-posts-title">Posts</h2>
          <div className="card-grid">
            {assigned.items.map((post: CmsContentItem) => <PostCard key={post.id} item={post} dataset={props.dataset} headingLevel={3} />)}
          </div>
          <Pagination
            page={assigned.page}
            totalPages={assigned.totalPages}
            totalItems={assigned.totalItems}
            label="Page posts"
            hrefForPage={(value: number) => pageHref(props.item!.slug, value)}
          />
        </section>
      ) : null}
    </article>
  );
}

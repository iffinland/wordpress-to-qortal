import { Pagination } from '../components/Pagination';
import { PostCard } from '../components/PostCard';
import { StateNotice } from '../components/StateNotice';
import { NotFoundPage } from './NotFoundPage';
import { paginate, postsForTerm } from '../lib/archive.js';
import { categoryHref, tagHref } from '../lib/routes.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset } from '../types';

export function TermPage(props: { dataset: CmsDataset; kind: 'category' | 'tag'; slug: string; page: number }) {
  const isCategory = props.kind === 'category';
  const available = isCategory ? props.dataset.availability.categories : props.dataset.availability.tags;
  const terms = isCategory ? props.dataset.categories : props.dataset.tags;
  if (!available) {
    return (
      <div className="page">
        <h1>{isCategory ? 'Categories' : 'Tags'}</h1>
        <StateNotice
          state="partial"
          title={(isCategory ? 'Categories' : 'Tags') + ' are unavailable'}
          message="The taxonomy index could not be read from QDN. This is not an empty result."
        />
      </div>
    );
  }
  const term = terms.find((entry) => entry.slug === props.slug || entry.id === props.slug);
  if (!term) {
    return <NotFoundPage title={(isCategory ? 'Category' : 'Tag') + ' not found'} message="No published term matches this address." />;
  }
  const page = paginate(postsForTerm(props.dataset.posts, term.id), props.page, cmsConfig.content.pageSize);
  const hrefForPage = (value: number) => (isCategory ? categoryHref(term.slug, value) : tagHref(term.slug, value));
  return (
    <div className="page">
      <p className="eyebrow">{isCategory ? 'Category' : 'Tag'}</p>
      <h1>{term.name}</h1>
      {!props.dataset.availability.posts ? (
        <StateNotice state="partial" title="Posts are unavailable" message="The posts index could not be read, so this term cannot list its posts." />
      ) : page.totalItems === 0 ? (
        <StateNotice state="empty" title="No published posts" message="This term exists, but no published posts reference it." />
      ) : (
        <>
          <div className="card-grid">
            {page.items.map((item: CmsContentItem) => <PostCard key={item.id} item={item} dataset={props.dataset} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Term pages" hrefForPage={hrefForPage} />
        </>
      )}
    </div>
  );
}

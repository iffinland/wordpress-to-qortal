import { Pagination } from '../components/Pagination';
import { PostCard } from '../components/PostCard';
import { StateNotice } from '../components/StateNotice';
import { archiveGroups, archivePosts, paginate } from '../lib/archive.js';
import { archiveHref } from '../lib/routes.js';
import { formatMonth } from '../lib/text.js';
import { cmsConfig } from '../config/cmsConfig';
import type { CmsContentItem, CmsDataset } from '../types';

export function ArchivePage(props: { dataset: CmsDataset; year?: number; month?: number; page: number }) {
  if (!props.dataset.availability.posts) {
    return (
      <div className="page">
        <h1>Archive</h1>
        <StateNotice state="partial" title="Posts are unavailable" message="The posts index could not be read from QDN. The archive cannot be built without it." />
      </div>
    );
  }
  const filtered = archivePosts(props.dataset.posts, props.year, props.month);
  const page = paginate(filtered, props.page, cmsConfig.content.pageSize);
  const groups = archiveGroups(props.dataset.posts);
  const period = props.year
    ? (props.month ? formatMonth(props.year, props.month) : String(props.year))
    : 'All years';
  return (
    <div className="page">
      <p className="eyebrow">Archive</p>
      <h1>{period}</h1>
      <nav className="archive-nav" aria-label="Archive periods">
        <p><a href={archiveHref()} aria-current={!props.year ? 'page' : undefined}>All years</a></p>
        <ul className="archive-nav__years">
          {groups.map((group) => (
            <li key={group.year}>
              <a href={archiveHref(group.year)} aria-current={props.year === group.year && !props.month ? 'page' : undefined}>{group.year}</a>
              <ul className="archive-nav__months">
                {group.months.map((entry) => (
                  <li key={entry.month}>
                    <a href={archiveHref(group.year, entry.month)} aria-current={props.year === group.year && props.month === entry.month ? 'page' : undefined}>
                      {formatMonth(group.year, entry.month)} ({entry.count})
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      {page.totalItems === 0 ? (
        <StateNotice state="empty" title="No posts in this period" message="The catalog is readable and no published posts match this archive period." />
      ) : (
        <>
          <div className="card-grid">
            {page.items.map((item: CmsContentItem) => <PostCard key={item.id} item={item} dataset={props.dataset} />)}
          </div>
          <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} label="Archive pages" hrefForPage={(value) => archiveHref(props.year, props.month, value)} />
        </>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { archiveHref } from '../app/routes';
import { Pagination } from '../components/content/Pagination';
import { PostGridSection } from '../components/content/PostGridSection';
import { archiveMonthLabel, createArchiveMonths, postsForArchiveMonth } from '../data/archive';
import type { ContentPost } from '../types/content';

const POSTS_PER_PAGE = 30;

export function ArchivePage({ posts, year, month, page }: { posts: ContentPost[]; year?: number; month?: number; page: number }) {
  const months = createArchiveMonths(posts);
  const selectedKey = year && month ? `${year}-${String(month).padStart(2, '0')}` : '';
  const matching = postsForArchiveMonth(posts, year, month);
  const pageCount = Math.max(1, Math.ceil(matching.length / POSTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visiblePosts = matching.slice((currentPage - 1) * POSTS_PER_PAGE, currentPage * POSTS_PER_PAGE);
  const title = year && month ? archiveMonthLabel(year, month) : 'Archive';

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedKey, currentPage]);

  function changeArchiveMonth(value: string) {
    if (!value) {
      window.location.hash = archiveHref().slice(1);
      return;
    }
    const [nextYear, nextMonth] = value.split('-').map((part) => Number.parseInt(part, 10));
    window.location.hash = archiveHref(nextYear, nextMonth).slice(1);
  }

  return (
    <section className="archive-page">
      <div className="archive-selector">
        <label>
          Browse archive
          <select value={selectedKey} onChange={(event) => changeArchiveMonth(event.target.value)}>
            <option value="">All posts</option>
            {months.map((item) => (
              <option key={item.key} value={item.key}>{item.label} ({item.count})</option>
            ))}
          </select>
        </label>
      </div>

      <PostGridSection title={title} posts={visiblePosts} showOlderEntries={false} />
      {matching.length === 0 && <p className="empty-message">No posts found for this archive period.</p>}
      {matching.length > 0 && (
        <>
          <p className="pagination-summary">Showing {(currentPage - 1) * POSTS_PER_PAGE + 1}-{Math.min(currentPage * POSTS_PER_PAGE, matching.length)} of {matching.length} posts</p>
          <Pagination currentPage={currentPage} pageCount={pageCount} hrefForPage={(nextPage) => archiveHref(year, month, nextPage)} />
        </>
      )}
    </section>
  );
}

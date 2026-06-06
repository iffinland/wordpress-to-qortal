import { useEffect } from 'react';
import { categoryHref, slugify, tagHref } from '../app/routes';
import { Pagination } from '../components/content/Pagination';
import { PostGridSection } from '../components/content/PostGridSection';
import type { ContentPost } from '../types/content';

const POSTS_PER_PAGE = 30;

export function CategoryPage({ slug, page, posts, taxonomy = 'category' }: { slug: string; page: number; posts: ContentPost[]; taxonomy?: 'category' | 'tag' }) {
  const matching = slug === 'archive' || slug === 'series'
    ? posts
    : posts.filter((post) => post[taxonomy === 'tag' ? 'tags' : 'categories'].some((term) => slugify(term) === slug));
  const title = slug.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
  const pageCount = Math.max(1, Math.ceil(matching.length / POSTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visiblePosts = matching.slice((currentPage - 1) * POSTS_PER_PAGE, currentPage * POSTS_PER_PAGE);
  const hrefForPage = taxonomy === 'tag'
    ? (nextPage: number) => tagHref(slug, nextPage)
    : (nextPage: number) => categoryHref(slug, nextPage);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [slug, currentPage, taxonomy]);

  return (
    <section className="category-page">
      <PostGridSection title={title} posts={visiblePosts} showOlderEntries={false} />
      {matching.length === 0 && <p className="empty-message">This category has no scaffold content yet. Migrated QDN resources will populate it.</p>}
      {matching.length > 0 && (
        <>
          <p className="pagination-summary">Showing {(currentPage - 1) * POSTS_PER_PAGE + 1}-{Math.min(currentPage * POSTS_PER_PAGE, matching.length)} of {matching.length} posts</p>
          <Pagination currentPage={currentPage} pageCount={pageCount} hrefForPage={hrefForPage} />
        </>
      )}
    </section>
  );
}

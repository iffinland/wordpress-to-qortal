import { slugify } from '../app/routes';
import { PostGridSection } from '../components/content/PostGridSection';
import type { ContentPost } from '../types/content';

export function CategoryPage({ slug, posts, taxonomy = 'category' }: { slug: string; posts: ContentPost[]; taxonomy?: 'category' | 'tag' }) {
  const matching = slug === 'archive' || slug === 'series'
    ? posts
    : posts.filter((post) => post[taxonomy === 'tag' ? 'tags' : 'categories'].some((term) => slugify(term) === slug));
  const title = slug.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');

  return (
    <section className="category-page">
      <PostGridSection title={title} posts={matching} />
      {matching.length === 0 && <p className="empty-message">This category has no scaffold content yet. Migrated QDN resources will populate it.</p>}
    </section>
  );
}

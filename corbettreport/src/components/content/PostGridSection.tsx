import type { ContentPost } from '../../types/content';
import { PostCard } from './PostCard';
import { SectionBand } from './SectionBand';

export function PostGridSection({ title, tone, posts, showOlderEntries = true }: { title: string; tone?: 'blue' | 'red' | 'black'; posts: ContentPost[]; showOlderEntries?: boolean }) {
  return (
    <section className="home-section">
      <SectionBand tone={tone}>{title}</SectionBand>
      <div className="post-grid">
        {posts.map((post) => <PostCard key={post.id} post={post} />)}
      </div>
      {showOlderEntries && <a className="older-entries" href="#/category/archive">« Older Entries</a>}
    </section>
  );
}

import { DocumentaryCarousel } from '../components/content/DocumentaryCarousel';
import { HeroFeature } from '../components/content/HeroFeature';
import { PostGridSection } from '../components/content/PostGridSection';
import type { SiteDataset } from '../types/content';

export function PublicHomePage({ dataset }: { dataset: SiteDataset }) {
  const posts = [...dataset.posts].sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
  const newsletterPosts = posts.filter((post) => post.categories.includes('Newsletter')).slice(0, 3);

  return (
    <>
      <HeroFeature post={posts[0]} />
      <PostGridSection title="Recent Posts" posts={posts.slice(0, 6)} />
      <PostGridSection title="Newsletter" tone="red" posts={newsletterPosts} />
      <DocumentaryCarousel documentaries={dataset.documentaries} />
    </>
  );
}

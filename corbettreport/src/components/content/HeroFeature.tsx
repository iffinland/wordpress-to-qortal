import { postHref } from '../../app/routes';
import type { ContentPost } from '../../types/content';

export function HeroFeature({ post }: { post: ContentPost }) {
  return (
    <section className="hero-feature" style={{ backgroundImage: `url(${post.heroImage || post.image})` }}>
      <strong className="hero-label">Latest Post</strong>
      <div className="hero-copy">
        <h1>{post.title}</h1>
        <p>{post.excerpt}</p>
        <a href={postHref(post.slug)}>read more</a>
      </div>
    </section>
  );
}

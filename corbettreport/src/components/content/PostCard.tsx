import { postHref } from '../../app/routes';
import type { ContentPost } from '../../types/content';

export function formatPostDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function PostCard({ post }: { post: ContentPost }) {
  return (
    <article className="post-card">
      {post.image && <a className="card-image" href={postHref(post.slug)}><img src={post.image} alt="" loading="lazy" /></a>}
      <div className="card-body">
        <h3><a href={postHref(post.slug)}>{post.title}</a></h3>
        <p>{formatPostDate(post.publishedAt)} | {post.categories.join(', ')}</p>
      </div>
    </article>
  );
}

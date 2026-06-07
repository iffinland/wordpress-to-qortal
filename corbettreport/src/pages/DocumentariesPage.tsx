import { documentariesHref, slugify } from '../app/routes';
import { ContentHtml } from '../components/content/ContentHtml';
import { PostGridSection } from '../components/content/PostGridSection';
import type { ContentPost, Documentary } from '../types/content';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

export function DocumentariesPage({
  post,
  loading,
  documentaries,
  documentaryPosts
}: {
  post: ContentPost | null;
  loading: boolean;
  documentaries: Documentary[];
  documentaryPosts: ContentPost[];
}) {
  if (post?.contentHtml) {
    return (
      <section className="page-shell static-page documentaries-page">
        <article>
          <p className="eyebrow">Documentaries</p>
          <h1>{post.title}</h1>
          <p className="documentaries-meta">{formatDate(post.publishedAt)} | by <strong>{post.author}</strong></p>
          <ContentHtml html={post.contentHtml} />
        </article>
      </section>
    );
  }

  return (
    <section className="page-shell documentaries-page">
      <header className="documentaries-header">
        <p className="eyebrow">Documentaries</p>
        <h1>Corbett Report Documentaries</h1>
        <p>
          This page will automatically use the imported Corbett Report documentaries master post when the historical migration reaches it.
          Until then, the available documentary entries are shown here.
        </p>
        {loading && <p className="documentaries-loading">Checking QDN for the imported documentaries master post...</p>}
      </header>

      {documentaries.length > 0 && (
        <div className="documentaries-card-grid">
          {documentaries.map((documentary) => (
            <a key={documentary.id} href={documentary.href || documentariesHref()} className="documentaries-card">
              <img src={documentary.image} alt={documentary.title} loading="lazy" />
              <strong>{documentary.title}</strong>
            </a>
          ))}
        </div>
      )}

      {documentaryPosts.length > 0 && (
        <PostGridSection title="Imported Documentary Posts" posts={documentaryPosts.slice(0, 30)} showOlderEntries={false} />
      )}

      {!loading && documentaries.length === 0 && documentaryPosts.length === 0 && (
        <p className="empty-message">Documentary content will appear here as migration batches are published and adopted.</p>
      )}
    </section>
  );
}

export function documentaryCategoryPosts(posts: ContentPost[]) {
  return posts.filter((post) =>
    post.categories.some((category) => slugify(category) === 'documentaries')
    || post.tags.some((tag) => slugify(tag) === 'documentaries')
  );
}

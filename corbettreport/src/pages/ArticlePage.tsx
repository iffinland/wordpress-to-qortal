import { ChevronLeft, MessageSquare } from 'lucide-react';
import { categoryHref } from '../app/routes';
import { ContentHtml } from '../components/content/ContentHtml';
import { formatPostDate } from '../components/content/PostCard';
import type { ContentPost } from '../types/content';

export function ArticlePage({ post }: { post: ContentPost }) {
  return (
    <section className="page-shell article-page">
      <a className="back-link" href="#/"><ChevronLeft size={17} /> Back to latest posts</a>
      <article>
        <header className="article-header">
          <p>{formatPostDate(post.publishedAt)} | by <strong>{post.author}</strong> | {post.categories.map((category, index) => <span key={category}>{index > 0 && ', '}<a href={categoryHref(category)}>{category}</a></span>)}</p>
          <h1>{post.title}</h1>
          <p className="article-excerpt">{post.excerpt}</p>
        </header>
        {post.image && <img className="article-lead-image" src={post.image} alt="" />}
        <ContentHtml html={post.contentHtml} />
      </article>
      <section className="comments-preview">
        <h2><MessageSquare size={21} /> Comments</h2>
        <p>QDN-native comments and author editing are reserved for the editorial workflow phase.</p>
      </section>
    </section>
  );
}

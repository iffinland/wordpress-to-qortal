import { StateNotice } from '../components/StateNotice';
import { PostCard } from '../components/PostCard';
import { publishedPosts } from '../lib/archive.js';
import { categoryHref, tagHref, archiveHref } from '../lib/routes.js';
import type { CmsDataset } from '../types';

export function HomePage(props: { dataset: CmsDataset }) {
  const dataset = props.dataset;
  const posts = publishedPosts(dataset.posts).slice(0, 6);
  return (
    <div className="page">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Qortal QDN publication</p>
        <h1 id="home-title">{dataset.site.title}</h1>
        {dataset.site.tagline ? <p className="hero__tagline">{dataset.site.tagline}</p> : null}
        <p className="hero__actions">
          <a className="button" href="#/posts">Browse posts</a>
          <a className="button button--ghost" href="#/search">Search the site</a>
        </p>
      </section>

      <section className="section" aria-labelledby="latest-title">
        <div className="section__header">
          <h2 id="latest-title">Latest posts</h2>
          <a href="#/posts">All posts</a>
        </div>
        {!dataset.availability.posts ? (
          <StateNotice state="partial" title="Posts are unavailable" message="The posts index could not be read. This is not an empty site." />
        ) : posts.length === 0 ? (
          <StateNotice state="empty" title="No published posts yet" message="The catalog loaded successfully and currently contains no published posts." />
        ) : (
          <div className="card-grid">
            {posts.map((item) => <PostCard key={item.id} item={item} dataset={dataset} headingLevel={3} />)}
          </div>
        )}
      </section>

      <div className="two-column">
        <section className="section" aria-labelledby="categories-title">
          <h2 id="categories-title">Categories</h2>
          {!dataset.availability.categories ? (
            <p className="muted">Categories are unavailable from the current catalog.</p>
          ) : dataset.categories.length === 0 ? (
            <p className="muted">No categories have been published yet.</p>
          ) : (
            <ul className="term-list">
              {dataset.categories.map((term) => (
                <li key={term.id}>
                  <a href={categoryHref(term.slug)}>{term.name}</a>
                  {typeof term.count === 'number' ? <span className="term-list__count">{term.count}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="section" aria-labelledby="tags-title">
          <h2 id="tags-title">Tags</h2>
          {!dataset.availability.tags ? (
            <p className="muted">Tags are unavailable from the current catalog.</p>
          ) : dataset.tags.length === 0 ? (
            <p className="muted">No tags have been published yet.</p>
          ) : (
            <ul className="term-list">
              {dataset.tags.map((term) => (
                <li key={term.id}>
                  <a href={tagHref(term.slug)}>{term.name}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section" aria-labelledby="archive-title">
        <h2 id="archive-title">Archive</h2>
        <p><a href={archiveHref()}>Browse the full archive</a></p>
      </section>
    </div>
  );
}

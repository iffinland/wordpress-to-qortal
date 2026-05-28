import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, ExternalLink, FileText, Image, Link, Play, Search, Tags } from 'lucide-react';
import { formatBytes, loadContent, loadIndexes, resolveMediaUrl, rewriteHtmlMedia } from './contentApi';
import type { ContentItem, IndexItem, MediaMap, Term } from './types';
import './styles.css';

interface LoadedData {
  posts: IndexItem[];
  pages: IndexItem[];
  categories: Term[];
  tags: Term[];
  mediaMap: MediaMap;
  postDetails: Map<number, ContentItem>;
}

type ViewMode = 'posts' | 'pages';

function decodeText(value: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function termNames(ids: number[], terms: Term[]): string[] {
  const byId = new Map(terms.map((term) => [term.source_id, term.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as string[];
}

function App() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ViewMode>('posts');
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndexes()
      .then(async (loaded) => {
        const postDetails = new Map<number, ContentItem>();
        const posts = await Promise.all(loaded.posts.map((post) => loadContent(post.file)));
        for (const post of posts) {
          postDetails.set(post.source_id, post);
        }

        setData({ ...loaded, postDetails });
        const first = loaded.posts[0] || loaded.pages[0];
        if (first) {
          setSelected(postDetails.get(first.source_id) || (await loadContent(first.file)));
        }
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, []);

  const activeIndex = mode === 'posts' ? data?.posts || [] : data?.pages || [];
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return activeIndex.filter((item) => {
      const matchesSearch = !normalized || `${item.title} ${item.slug}`.toLowerCase().includes(normalized);
      const matchesCategory = mode !== 'posts' || categoryId === 'all' || selectedCategoryMatches(item, categoryId);
      return matchesSearch && matchesCategory;
    });
  }, [activeIndex, categoryId, mode, query]);

  function selectedCategoryMatches(item: IndexItem, category: number): boolean {
    return data?.postDetails.get(item.source_id)?.categories.includes(category) || false;
  }

  async function openItem(item: IndexItem) {
    try {
      setError(null);
      setSelected(data?.postDetails.get(item.source_id) || (await loadContent(item.file)));
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  if (error) {
    return <div className="app-error">{error}</div>;
  }

  if (!data || !selected) {
    return <div className="app-loading">Loading local Qortal content...</div>;
  }

  const categoryNames = termNames(selected.categories, data.categories);
  const tagNames = termNames(selected.tags, data.tags);
  const rewrittenHtml = rewriteHtmlMedia(selected.content_html, data.mediaMap);
  const selectedMedia = collectSelectedMedia(selected, data.mediaMap);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <p className="eyebrow">Qortal Migration Demo</p>
          <h1>Content Viewer</h1>
          <div className="summary-grid">
            <span>{data.posts.length} posts</span>
            <span>{data.pages.length} pages</span>
            <span>{Object.values(data.mediaMap).filter((item) => item.downloaded).length} media</span>
          </div>
        </header>

        <div className="toolbar">
          <button className={mode === 'posts' ? 'active' : ''} onClick={() => setMode('posts')}>
            Posts
          </button>
          <button className={mode === 'pages' ? 'active' : ''} onClick={() => setMode('pages')}>
            Pages
          </button>
        </div>

        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or slug" />
        </label>

        {mode === 'posts' && (
          <select className="select" value={categoryId} onChange={(event) => setCategoryId(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
            <option value="all">All categories</option>
            {data.categories.map((category) => (
              <option key={category.source_id} value={category.source_id}>
                {decodeText(category.name)}
              </option>
            ))}
          </select>
        )}

        <nav className="content-list">
          {filteredItems.map((item) => (
            <button key={`${item.type}-${item.source_id}`} className={selected.source_id === item.source_id ? 'selected' : ''} onClick={() => openItem(item)}>
              <span>{decodeText(item.title)}</span>
              <small>{new Date(item.date).toLocaleDateString()}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="reader">
        <article className="article">
          <div className="article-meta">
            <span>
              <CalendarDays size={16} />
              {new Date(selected.date).toLocaleString()}
            </span>
            <span>
              <FileText size={16} />
              Source #{selected.source_id}
            </span>
          </div>

          <h2>{decodeText(selected.title)}</h2>
          {selected.summary && <p className="summary">{decodeText(selected.summary)}</p>}

          <div className="chips">
            {categoryNames.map((name) => (
              <span key={name}>{decodeText(name)}</span>
            ))}
            {tagNames.slice(0, 12).map((name) => (
              <span key={name}>
                <Tags size={13} />
                {decodeText(name)}
              </span>
            ))}
          </div>

          <div className="content-grid">
            <div className="wp-content" dangerouslySetInnerHTML={{ __html: rewrittenHtml }} />
            <aside className="resource-panel">
              <ResourceBlock title="Images" icon={<Image size={17} />} items={selectedMedia.images} mediaMap={data.mediaMap} />
              <ResourceBlock title="Video" icon={<Play size={17} />} items={selectedMedia.video} mediaMap={data.mediaMap} />
              <ResourceBlock title="Documents" icon={<FileText size={17} />} items={selectedMedia.documents} mediaMap={data.mediaMap} />
              <ResourceBlock title="External links" icon={<ExternalLink size={17} />} items={selected.links.external.slice(0, 16)} mediaMap={data.mediaMap} />
            </aside>
          </div>
        </article>
      </section>
    </main>
  );
}

function collectSelectedMedia(item: ContentItem, mediaMap: MediaMap) {
  const attachmentUrls = item.attachments.map((attachment) => attachment.source_url);
  const images = [...new Set([...item.media.images, ...attachmentUrls.filter((url) => mediaMap[url]?.type === 'image')])];
  const video = [...new Set([...item.media.video, ...attachmentUrls.filter((url) => mediaMap[url]?.type === 'video')])];
  const documents = [...new Set([...item.media.documents, ...attachmentUrls.filter((url) => mediaMap[url]?.type === 'document')])];
  return { images, video, documents };
}

function ResourceBlock({ title, icon, items, mediaMap }: { title: string; icon: React.ReactNode; items: string[]; mediaMap: MediaMap }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="resource-block">
      <h3>
        {icon}
        {title}
        <span>{items.length}</span>
      </h3>
      <div className="resource-list">
        {items.map((item) => {
          const media = mediaMap[item];
          const href = resolveMediaUrl(item, mediaMap);
          const label = item.split('/').pop() || item;
          return (
            <a key={item} href={href} target="_blank" rel="noreferrer">
              <Link size={14} />
              <span>{decodeText(label)}</span>
              {media?.bytes && <small>{formatBytes(media.bytes)}</small>}
            </a>
          );
        })}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

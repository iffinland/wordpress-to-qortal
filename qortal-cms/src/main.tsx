import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Edit3, Eye, FileText, Image, Plus, RefreshCcw, Save, Search, Send, Tags } from 'lucide-react';
import { createSourceFromLocation, type CmsData, type CmsSource } from './contentSource';
import { hasQortalBridge, requestQortal, toBase64 } from './qortalClient';
import { RichTextEditor } from './RichTextEditor';
import type { ContentItem, IndexItem, Term } from './types';
import './styles.css';

type PanelMode = 'preview' | 'edit';

interface DraftState {
  title: string;
  summary: string;
  contentHtml: string;
  slug?: string;
}

function decodeText(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function termNames(ids: number[], terms: Term[]) {
  const byId = new Map(terms.map((term) => [term.source_id, decodeText(term.name)]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as string[];
}

function createDraft(post: ContentItem): DraftState {
  return {
    title: decodeText(post.title),
    summary: decodeText(post.summary || post.excerpt_text || ''),
    contentHtml: post.content_html
  };
}

function createSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || `post-${Date.now().toString(36)}`;
}

function createNewPostDraft(): DraftState {
  return {
    title: 'Untitled post',
    summary: '',
    contentHtml: '<p></p>',
    slug: `new-post-${Date.now().toString(36)}`
  };
}

function App() {
  const [source, setSource] = useState<CmsSource | null>(null);
  const [data, setData] = useState<CmsData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<IndexItem | null>(null);
  const [selectedPost, setSelectedPost] = useState<ContentItem | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('preview');
  const [isNewPost, setIsNewPost] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadApp() {
    setError(null);
    setStatus('Loading content source...');
    const nextSource = await createSourceFromLocation();
    const nextData = await nextSource.loadInitialData();
    const first = nextData.posts[0] || null;
    const firstPost = first ? await nextSource.loadContent(first.file) : null;

    setSource(nextSource);
    setData(nextData);
    setSelectedIndex(first);
    setSelectedPost(firstPost);
    setDraft(firstPost ? createDraft(firstPost) : null);
    setStatus('');
  }

  useEffect(() => {
    loadApp().catch((loadError: Error) => {
      setError(loadError.message);
      setStatus('');
    });
  }, []);

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.posts || []).filter((post) =>
      !normalized ? true : `${post.title} ${post.slug}`.toLowerCase().includes(normalized)
    );
  }, [data?.posts, query]);

  async function openPost(post: IndexItem) {
    if (!source) return;
    setError(null);
    setStatus('Loading post...');
    try {
      const content = await source.loadContent(post.file);
      setSelectedIndex(post);
      setSelectedPost(content);
      setDraft(createDraft(content));
      setIsNewPost(false);
      setPanelMode('preview');
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setStatus('');
    }
  }

  function applyDraftToPost(): ContentItem | null {
    if (!draft) return null;
    if (isNewPost) {
      const now = new Date().toISOString();
      const slug = createSlug(draft.slug || draft.title);
      return {
        type: 'post',
        source: 'qortal-cms',
        source_id: Date.now(),
        old_url: '',
        slug,
        title: draft.title,
        date: now,
        modified: now,
        status: 'publish',
        file: `posts/${slug}.json`,
        excerpt: draft.summary,
        excerpt_text: draft.summary,
        content_html: draft.contentHtml,
        content_text: draft.contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        summary: draft.summary,
        categories: [],
        tags: [],
        featured_media: null,
        attachments: [],
        links: {
          internal: [],
          external: []
        },
        media: {
          images: [],
          audio: [],
          video: [],
          documents: [],
          embeds: []
        },
        import: {
          imported_at: now,
          importer_version: 'qortal-cms-0.1.0'
        }
      };
    }

    if (!selectedPost) return null;
    return {
      ...selectedPost,
      title: draft.title,
      summary: draft.summary,
      excerpt_text: draft.summary,
      content_html: draft.contentHtml,
      modified: new Date().toISOString()
    };
  }

  async function publishDraft() {
    if (!source || !draft) return;
    if (!hasQortalBridge()) {
      setError('Qortal request API is not available. Open this CMS through Qortal UI dev mode.');
      return;
    }

    const nextPost = applyDraftToPost();
    if (!nextPost) return;

    const existingResource = selectedIndex ? source.getResourceForPath(`converted/${selectedIndex.file}`) : null;
    const resource = existingResource || {
      service: 'DOCUMENT',
      identifier: `cr-post-${createSlug(nextPost.slug || nextPost.title)}-${Date.now().toString(36)}`
    };

    const qdnName = source.qdnName || new URLSearchParams(window.location.search).get('name') || '';
    if (!qdnName) {
      setError('Missing Qortal name. Use ?source=qdn&name=<QortalName> for publish tests.');
      return;
    }

    setStatus('Publishing draft...');
    setError(null);
    try {
      await requestQortal({
        action: 'PUBLISH_QDN_RESOURCE',
        name: qdnName,
        service: resource.service,
        identifier: resource.identifier,
        data64: toBase64(JSON.stringify(nextPost, null, 2)),
        encoding: 'base64',
        title: nextPost.title,
        description: `Edited post: ${nextPost.summary || nextPost.slug}`.slice(0, 4000)
      });
      setSelectedPost(nextPost);
      if (isNewPost) {
        const nextIndex: IndexItem = {
          type: 'post',
          source_id: nextPost.source_id,
          old_url: '',
          slug: nextPost.slug,
          title: nextPost.title,
          date: nextPost.date,
          modified: nextPost.modified,
          status: nextPost.status,
          file: nextPost.file
        };
        setSelectedIndex(nextIndex);
        setData((current) => current ? { ...current, posts: [nextIndex, ...current.posts] } : current);
        setIsNewPost(false);
      }
      setStatus('Draft published.');
    } catch (publishError) {
      setError((publishError as Error).message);
      setStatus('');
    }
  }

  const categoryNames = selectedPost && data ? termNames(selectedPost.categories, data.categories) : [];
  const tagNames = selectedPost && data ? termNames(selectedPost.tags, data.tags).slice(0, 12) : [];
  const heroImage = selectedPost?.media.images[0];
  const heroSrc = heroImage && source && data ? source.resolveMediaUrl(heroImage, data.mediaMap) : '';
  const previewHtml = draft?.contentHtml || selectedPost?.content_html || '';

  function startNewPost() {
    const nextDraft = createNewPostDraft();
    setSelectedIndex(null);
    setSelectedPost(null);
    setDraft(nextDraft);
    setIsNewPost(true);
    setPanelMode('edit');
    setStatus('New post draft created.');
    setError(null);
  }

  return (
    <main className="cms-shell">
      <aside className="cms-sidebar">
        <div className="brand">
          <p>Qortal CMS</p>
          <h1>Imported Content</h1>
          <span>{source?.label || 'Loading source'}</span>
        </div>

        <label className="search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts" />
        </label>

        <button className="new-post-button" onClick={startNewPost}>
          <Plus size={17} />
          New post
        </button>

        <div className="post-list">
          {filteredPosts.map((post) => (
            <button
              key={post.source_id}
              className={selectedIndex?.source_id === post.source_id ? 'active' : ''}
              onClick={() => openPost(post)}
            >
              <strong>{decodeText(post.title)}</strong>
              <span>{new Date(post.date).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="cms-reader">
        {error && <div className="notice error">{error}</div>}
        {status && <div className="notice">{status}</div>}

        {(selectedPost || draft) && (
          <>
            {heroSrc && <img className="hero-image" src={heroSrc} alt="" />}
            <div className="post-meta">
              <span><FileText size={16} /> {isNewPost ? 'New post' : `Source #${selectedPost?.source_id}`}</span>
              <span><Tags size={16} /> {categoryNames.join(', ') || 'Uncategorized'}</span>
            </div>
            <h2>{draft?.title || decodeText(selectedPost?.title || 'Untitled post')}</h2>
            <p className="summary">{draft?.summary || decodeText(selectedPost?.summary || '')}</p>
            <div className="tag-row">
              {tagNames.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <article className="content-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </>
        )}
      </section>

      <aside className="cms-editor">
        <div className="editor-tabs">
          <button className={panelMode === 'preview' ? 'active' : ''} onClick={() => setPanelMode('preview')}>
            <Eye size={16} /> Preview
          </button>
          <button className={panelMode === 'edit' ? 'active' : ''} onClick={() => setPanelMode('edit')}>
            <Edit3 size={16} /> Edit
          </button>
        </div>

        {panelMode === 'preview' && selectedPost && (
          <div className="resource-box">
            <h3><Image size={17} /> Resources</h3>
            <p>{selectedPost.media.images.length} images</p>
            <p>{selectedPost.media.video.length} videos</p>
            <p>{selectedPost.links.external.length} external links</p>
          </div>
        )}

        {panelMode === 'edit' && draft && (
          <div className="edit-form">
            <label>
              Title
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label>
              Summary
              <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
            </label>
            {isNewPost && (
              <label>
                Slug
                <input value={draft.slug || ''} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} />
              </label>
            )}
            <div className="editor-field">
              <span>Content</span>
              <RichTextEditor value={draft.contentHtml} onChange={(contentHtml) => setDraft({ ...draft, contentHtml })} />
            </div>
            <button className="secondary" onClick={() => selectedPost ? setDraft(createDraft(selectedPost)) : setDraft(createNewPostDraft())}>
              <RefreshCcw size={16} /> Reset
            </button>
            <button className="primary" onClick={publishDraft}>
              <Send size={16} /> {isNewPost ? 'Publish new post' : 'Publish edited post'}
            </button>
          </div>
        )}

        <div className="resource-box">
          <h3><Save size={17} /> Status</h3>
          <p>Bridge: {hasQortalBridge() ? 'available' : 'not available'}</p>
          <p>Mode: {source?.mode || 'loading'}</p>
        </div>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

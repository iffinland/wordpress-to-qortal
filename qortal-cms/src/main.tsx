import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, Edit3, Eye, FileText, Filter, Image, Lock, MessageSquare, Plus, RefreshCcw, Save, Search, Send, Settings, Tags, User, XCircle } from 'lucide-react';
import { RichTextEditor } from './RichTextEditor';
import {
  CATEGORIES_IDENTIFIER,
  CMS_VERSION,
  COMMENTS_INDEX_IDENTIFIER,
  MANIFEST_IDENTIFIER,
  PAGES_INDEX_IDENTIFIER,
  POSTS_INDEX_IDENTIFIER,
  TAGS_IDENTIFIER,
  createCommentIdentifier,
  createEmptyManifest,
  createPostIdentifier,
  getQdnNameFromLocation,
  getViewerIdentity,
  loadDataset,
  loadPost,
  publishJsonResource,
  qdnLink,
  saveLocalDataset,
  slugify,
  toPostIndexItem
} from './cmsRepository';
import { hasQortalBridge } from './qortalClient';
import type { CmsComment, CmsDataset, CmsPost, CmsPostIndexItem, CmsStatus, ViewerIdentity } from './types';
import './styles.css';

type Section = 'dashboard' | 'posts' | 'media' | 'imported' | 'settings';
type EditorMode = 'preview' | 'edit';

interface DraftState {
  title: string;
  slug: string;
  excerpt: string;
  content_html: string;
  status: CmsStatus;
  comments_enabled: boolean;
  categoryText: string;
  tagText: string;
}

function decodeText(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function createDraft(post: CmsPost): DraftState {
  return {
    title: decodeText(post.title),
    slug: post.slug,
    excerpt: decodeText(post.excerpt),
    content_html: post.content_html,
    status: post.status,
    comments_enabled: post.comments_enabled,
    categoryText: post.category_ids.join(', '),
    tagText: post.tag_ids.join(', ')
  };
}

function emptyPost(ownerName: string, ownerAddress: string): CmsPost {
  const created = new Date().toISOString();
  const slug = `new-post-${Date.now().toString(36)}`;
  return {
    schema: 'qortal-cms/post@1',
    id: `post-${Date.now().toString(36)}`,
    type: 'post',
    title: 'Untitled post',
    slug,
    status: 'draft',
    excerpt: '',
    category_ids: [],
    tag_ids: [],
    created_at: created,
    updated_at: created,
    published_at: null,
    qdn: { service: 'DOCUMENT', identifier: createPostIdentifier(slug), name: ownerName },
    content_html: '<p></p>',
    featured_image: null,
    media: [],
    comments_enabled: true,
    author: { name: ownerName || 'local-owner', address: ownerAddress }
  };
}

function listFromText(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function termsFromText(value: string, existing: CmsDataset['categories']) {
  const now = new Date().toISOString();
  const bySlug = new Map(existing.map((term) => [term.slug, term]));
  const nextTerms = [...existing];
  const ids: string[] = [];

  for (const name of listFromText(value)) {
    const slug = slugify(name);
    const existingTerm = bySlug.get(slug);
    if (existingTerm) {
      ids.push(existingTerm.id);
      continue;
    }
    const term = { id: `term-${slug}`, name, slug, created_at: now, updated_at: now };
    bySlug.set(slug, term);
    nextTerms.push(term);
    ids.push(term.id);
  }

  return { ids, terms: nextTerms };
}

function App() {
  const qdnName = getQdnNameFromLocation();
  const [section, setSection] = useState<Section>('posts');
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [dataset, setDataset] = useState<CmsDataset | null>(null);
  const [identity, setIdentity] = useState<ViewerIdentity | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<CmsPostIndexItem | null>(null);
  const [selectedPost, setSelectedPost] = useState<CmsPost | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CmsStatus | 'all'>('all');
  const [commentDraft, setCommentDraft] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boot().catch((bootError: Error) => {
      setError(bootError.message);
      setStatus('');
    });
  }, []);

  async function boot() {
    setStatus('Loading CMS dataset...');
    const loadedDataset = await loadDataset(qdnName);
    const viewerIdentity = await getViewerIdentity(qdnName || loadedDataset.manifest.owner_name);
    setDataset(loadedDataset);
    setIdentity(viewerIdentity);
    const first = loadedDataset.posts[0] || null;
    setSelectedIndex(first);
    if (first) {
      const post = await safeLoadPost(first, loadedDataset);
      setSelectedPost(post);
      setDraft(createDraft(post));
    }
    setStatus('');
  }

  async function safeLoadPost(index: CmsPostIndexItem, data = dataset): Promise<CmsPost> {
    const fallback = data?.local_posts?.[index.id];
    try {
      return await loadPost(index.qdn, fallback);
    } catch {
      if (fallback) return fallback;
      throw new Error(`Unable to load post ${index.qdn.identifier}.`);
    }
  }

  const isOwner = identity?.role === 'owner';
  const canComment = Boolean(identity?.bridgeAvailable && identity.name && selectedPost?.comments_enabled);
  const commentsForPost = useMemo(() => {
    return (dataset?.comments || []).filter((comment) => comment.post_id === selectedPost?.id && comment.status === 'published');
  }, [dataset?.comments, selectedPost?.id]);

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (dataset?.posts || []).filter((post) => {
      const matchesSearch = !normalized || `${post.title} ${post.slug} ${post.excerpt}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [dataset?.posts, query, statusFilter]);

  async function openPost(index: CmsPostIndexItem) {
    if (!dataset) return;
    setError(null);
    setStatus('Opening post...');
    try {
      const post = await safeLoadPost(index, dataset);
      setSelectedIndex(index);
      setSelectedPost(post);
      setDraft(createDraft(post));
      setEditorMode('preview');
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      setStatus('');
    }
  }

  function startNewPost() {
    if (!dataset || !identity) return;
    const post = emptyPost(qdnName || dataset.manifest.owner_name, identity.address);
    setSelectedIndex(toPostIndexItem(post));
    setSelectedPost(post);
    setDraft(createDraft(post));
    setEditorMode('edit');
    setSection('posts');
    setStatus('New post draft created.');
  }

  function applyDraft(): { post: CmsPost; nextDataset: CmsDataset } | null {
    if (!dataset || !selectedPost || !draft || !identity) return null;
    const slug = slugify(draft.slug || draft.title);
    const categoryResult = termsFromText(draft.categoryText, dataset.categories);
    const tagResult = termsFromText(draft.tagText, dataset.tags);
    const updatedAt = new Date().toISOString();
    const post: CmsPost = {
      ...selectedPost,
      title: draft.title,
      slug,
      excerpt: draft.excerpt,
      content_html: draft.content_html,
      status: draft.status,
      category_ids: categoryResult.ids,
      tag_ids: tagResult.ids,
      comments_enabled: draft.comments_enabled,
      updated_at: updatedAt,
      published_at: draft.status === 'published' ? selectedPost.published_at || updatedAt : selectedPost.published_at,
      qdn: {
        ...selectedPost.qdn,
        name: qdnName || dataset.manifest.owner_name,
        identifier: selectedPost.qdn.identifier || createPostIdentifier(slug)
      },
      author: selectedPost.author.name ? selectedPost.author : { name: identity.name, address: identity.address }
    };
    const index = toPostIndexItem(post);
    const exists = dataset.posts.some((item) => item.id === index.id);
    const posts = exists
      ? dataset.posts.map((item) => item.id === index.id ? index : item)
      : [index, ...dataset.posts];
    const nextDataset: CmsDataset = {
      ...dataset,
      manifest: { ...dataset.manifest, updated_at: updatedAt, owner_name: qdnName || dataset.manifest.owner_name, owner_address: dataset.manifest.owner_address || identity.address },
      posts,
      categories: categoryResult.terms,
      tags: tagResult.terms,
      local_posts: { ...(dataset.local_posts || {}), [post.id]: post }
    };
    return { post, nextDataset };
  }

  async function saveDraftLocal() {
    const applied = applyDraft();
    if (!applied) return;
    setDataset(applied.nextDataset);
    setSelectedPost(applied.post);
    setSelectedIndex(toPostIndexItem(applied.post));
    saveLocalDataset(applied.nextDataset);
    setStatus('Draft saved locally.');
  }

  async function publishPost() {
    if (!dataset || !identity || !isOwner) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI dev mode to publish.');
      return;
    }
    const applied = applyDraft();
    if (!applied) return;

    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    if (!ownerName) {
      setError('Missing owner Qortal name. Open with ?name=<QortalName>.');
      return;
    }

    setError(null);
    try {
      setStatus('Publishing post...');
      await publishJsonResource(ownerName, applied.post.qdn, applied.post, applied.post.title, stripHtml(applied.post.excerpt || applied.post.content_html).slice(0, 4000));

      setStatus('Updating CMS indexes...');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER }, applied.nextDataset.posts, 'CMS posts index', 'Qortal CMS posts index');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: PAGES_INDEX_IDENTIFIER }, applied.nextDataset.pages, 'CMS pages index', 'Qortal CMS pages index');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER }, applied.nextDataset.categories, 'CMS categories', 'Qortal CMS categories');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER }, applied.nextDataset.tags, 'CMS tags', 'Qortal CMS tags');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER }, applied.nextDataset.comments, 'CMS comments index', 'Qortal CMS comments index');
      await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER }, applied.nextDataset.manifest, 'CMS manifest', 'Qortal CMS manifest');

      setDataset(applied.nextDataset);
      setSelectedPost(applied.post);
      setSelectedIndex(toPostIndexItem(applied.post));
      saveLocalDataset(applied.nextDataset);
      setStatus('Published to QDN.');
    } catch (publishError) {
      setError((publishError as Error).message);
      setStatus('');
    }
  }

  async function publishComment() {
    if (!dataset || !selectedPost || !identity || !commentDraft.trim()) return;
    if (!identity.bridgeAvailable || !identity.name) {
      setError('Comment publishing requires Qortal UI and a logged-in Qortal name.');
      return;
    }

    const created = new Date().toISOString();
    const comment: CmsComment = {
      schema: 'qortal-cms/comment@1',
      id: `comment-${Date.now().toString(36)}`,
      post_id: selectedPost.id,
      post_identifier: selectedPost.qdn.identifier,
      body_html: commentDraft,
      status: 'published',
      created_at: created,
      updated_at: created,
      author: { name: identity.name, address: identity.address },
      qdn: { service: 'DOCUMENT', identifier: createCommentIdentifier(selectedPost.id), name: identity.name }
    };

    try {
      setStatus('Publishing comment...');
      await publishJsonResource(identity.name, comment.qdn, comment, `Comment on ${selectedPost.title}`, stripHtml(comment.body_html).slice(0, 4000));
      const nextDataset = { ...dataset, comments: [comment, ...dataset.comments] };
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setCommentDraft('');
      setStatus('Comment published. Owner-side comment index sync will be handled in the moderation workflow.');
    } catch (commentError) {
      setError((commentError as Error).message);
      setStatus('');
    }
  }

  function initLocalSite() {
    const ownerName = qdnName || identity?.name || 'local-owner';
    const ownerAddress = identity?.address || '';
    const nextDataset = {
      manifest: createEmptyManifest(ownerName, ownerAddress),
      posts: [],
      pages: [],
      categories: [],
      tags: [],
      comments: [],
      local_posts: {}
    };
    setDataset(nextDataset);
    saveLocalDataset(nextDataset);
    setSelectedIndex(null);
    setSelectedPost(null);
    setDraft(null);
    setStatus('Local CMS dataset initialized.');
  }

  if (error && !dataset) return <div className="app-message error"><XCircle />{error}</div>;
  if (!dataset || !identity) return <div className="app-message"><RefreshCcw className="spin" />Loading Qortal CMS...</div>;

  const selectedCategoryNames = selectedPost?.category_ids.map((id) => dataset.categories.find((term) => term.id === id)?.name).filter(Boolean) || [];
  const selectedTagNames = selectedPost?.tag_ids.map((id) => dataset.tags.find((term) => term.id === id)?.name).filter(Boolean) || [];
  const ownerTarget = qdnName || dataset.manifest.owner_name || 'not set';

  return (
    <main className="cms-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p>Qortal CMS</p>
          <h1>{dataset.manifest.title}</h1>
          <span>Version {CMS_VERSION}</span>
        </div>

        <nav className="nav-list">
          <button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}><Eye size={17} /> Dashboard</button>
          <button className={section === 'posts' ? 'active' : ''} onClick={() => setSection('posts')}><FileText size={17} /> Posts</button>
          <button className={section === 'media' ? 'active' : ''} onClick={() => setSection('media')}><Image size={17} /> Media</button>
          <button className={section === 'imported' ? 'active' : ''} onClick={() => setSection('imported')}><Tags size={17} /> Imported</button>
          <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}><Settings size={17} /> Settings</button>
        </nav>

        <div className="identity-card">
          <User size={17} />
          <div>
            <strong>{identity.name || 'No Qortal name detected'}</strong>
            <span>{isOwner ? 'Owner controls enabled' : 'Read-only mode'}</span>
            <small>Owner target: {ownerTarget}</small>
            {identity.names.length > 1 && <small>Detected names: {identity.names.join(', ')}</small>}
          </div>
        </div>
      </aside>

      <section className="list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Content</p>
            <h2>{section === 'posts' ? 'Posts' : section.charAt(0).toUpperCase() + section.slice(1)}</h2>
          </div>
          {isOwner && <button className="icon-command primary" onClick={startNewPost}><Plus size={17} /> New</button>}
        </div>

        {section === 'dashboard' && (
          <div className="metric-grid">
            <div><strong>{dataset.posts.length}</strong><span>posts</span></div>
            <div><strong>{dataset.posts.filter((post) => post.status === 'draft').length}</strong><span>drafts</span></div>
            <div><strong>{dataset.comments.length}</strong><span>comments</span></div>
            <div><strong>{identity.bridgeAvailable ? 'Ready' : 'Offline'}</strong><span>bridge</span></div>
          </div>
        )}

        {section === 'posts' && (
          <>
            <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts" /></label>
            <label className="filter-box"><Filter size={17} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CmsStatus | 'all')}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
            <div className="post-list">
              {filteredPosts.map((post) => (
                <button key={post.id} className={selectedIndex?.id === post.id ? 'selected' : ''} onClick={() => openPost(post)}>
                  <strong>{decodeText(post.title)}</strong>
                  <span>{post.status} · {new Date(post.updated_at).toLocaleString()}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {section === 'media' && <div className="placeholder"><Image size={22} /><strong>Media library planned.</strong><span>Upload, QDN media index, and editor insertion controls will live here.</span></div>}
        {section === 'imported' && <div className="placeholder"><Tags size={22} /><strong>Imported Content planned.</strong><span>This view will read migrator manifests and adopt selected posts into the CMS index.</span></div>}
        {section === 'settings' && <div className="settings-list"><p><strong>Owner name:</strong> {dataset.manifest.owner_name || qdnName || 'not set'}</p><p><strong>Manifest:</strong> DOCUMENT / {MANIFEST_IDENTIFIER}</p><p><strong>Posts index:</strong> DOCUMENT / {POSTS_INDEX_IDENTIFIER}</p><button className="icon-command" onClick={initLocalSite}><RefreshCcw size={16} /> Reset local dataset</button></div>}
      </section>

      <section className="workspace">
        <div className="top-status">
          <span>{status || 'Ready'}</span>
          {error && <span className="error-text">{error}</span>}
          <span className={identity.bridgeAvailable ? 'ok' : 'muted'}>{identity.bridgeAvailable ? 'Qortal bridge available' : 'Browser preview only'}</span>
        </div>

        {selectedPost && draft ? (
          <>
            <div className="editor-tabs">
              <button className={editorMode === 'preview' ? 'active' : ''} onClick={() => setEditorMode('preview')}><Eye size={16} /> Preview</button>
              {isOwner && <button className={editorMode === 'edit' ? 'active' : ''} onClick={() => setEditorMode('edit')}><Edit3 size={16} /> Edit</button>}
            </div>

            {editorMode === 'preview' && (
              <article className="preview-pane">
                <div className="post-meta"><span>{selectedPost.status}</span><span>{new Date(selectedPost.updated_at).toLocaleString()}</span>{selectedPost.qdn.name && <a href={qdnLink(selectedPost.qdn)} target="_blank" rel="noreferrer">QDN resource</a>}</div>
                <h2>{decodeText(selectedPost.title)}</h2>
                {selectedPost.excerpt && <p className="summary">{decodeText(selectedPost.excerpt)}</p>}
                <div className="chip-row">{selectedCategoryNames.map((name) => <span key={name}>{name}</span>)}{selectedTagNames.map((name) => <span key={name}>{name}</span>)}</div>
                <div className="content-preview" dangerouslySetInnerHTML={{ __html: selectedPost.content_html }} />
              </article>
            )}

            {editorMode === 'edit' && isOwner && (
              <div className="edit-pane">
                <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value, slug: slugify(event.target.value) })} /></label>
                <label>Slug<input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
                <label>Excerpt<textarea value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} /></label>
                <div className="split-fields"><label>Categories<input value={draft.categoryText} onChange={(event) => setDraft({ ...draft, categoryText: event.target.value })} placeholder="News, Research" /></label><label>Tags<input value={draft.tagText} onChange={(event) => setDraft({ ...draft, tagText: event.target.value })} placeholder="Qortal, Podcast" /></label></div>
                <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CmsStatus })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
                <label className="check-line"><input type="checkbox" checked={draft.comments_enabled} onChange={(event) => setDraft({ ...draft, comments_enabled: event.target.checked })} /> Comments enabled</label>
                <RichTextEditor value={draft.content_html} onChange={(content_html) => setDraft({ ...draft, content_html })} />
                <div className="action-row"><button className="icon-command" onClick={saveDraftLocal}><Save size={16} /> Save local</button><button className="icon-command primary" onClick={publishPost}><Send size={16} /> Publish to QDN</button></div>
              </div>
            )}

            <section className="comments-panel">
              <div className="panel-title"><MessageSquare size={18} /><h3>Comments</h3><span>{commentsForPost.length}</span></div>
              {selectedPost.comments_enabled ? (
                <>
                  {commentsForPost.map((comment) => (
                    <article key={comment.id} className="comment-card"><strong>{comment.author.name}</strong><span>{new Date(comment.updated_at).toLocaleString()}</span><div dangerouslySetInnerHTML={{ __html: comment.body_html }} />{identity.name === comment.author.name && <button className="text-button">Edit own comment ready</button>}</article>
                  ))}
                  <div className="comment-box"><RichTextEditor value={commentDraft} onChange={setCommentDraft} /><button className="icon-command" disabled={!canComment} onClick={publishComment}><Send size={16} /> Publish comment</button>{!canComment && <small>Commenting requires Qortal UI, a logged-in Qortal name, and comments enabled for this post.</small>}</div>
                </>
              ) : <p className="muted-text"><Lock size={16} /> Comments are disabled for this post.</p>}
            </section>
          </>
        ) : (
          <div className="placeholder"><FileText size={24} /><strong>No post selected</strong><span>{isOwner ? 'Create a new post or select an existing one.' : 'Select a published post to read.'}</span></div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

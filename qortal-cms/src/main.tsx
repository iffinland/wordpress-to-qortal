import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, Coins, Copy, Download, Edit3, Eye, FileText, Filter, Heart, Image, Link, Lock, MessageSquare, Paperclip, Play, Plus, RefreshCcw, Save, Search, Send, Settings, Share2, Tags, Trash2, Upload, User, Video, XCircle } from 'lucide-react';
import { RichTextEditor } from './RichTextEditor';
import {
  CATEGORIES_IDENTIFIER,
  CMS_VERSION,
  COMMENTS_INDEX_IDENTIFIER,
  MANIFEST_IDENTIFIER,
  MEDIA_INDEX_IDENTIFIER,
  PAGES_INDEX_IDENTIFIER,
  POSTS_INDEX_IDENTIFIER,
  TAGS_IDENTIFIER,
  createCommentIdentifier,
  createEmptyManifest,
  createMediaItem,
  createPostIdentifier,
  getQdnNameFromLocation,
  getViewerIdentity,
  loadDataset,
  loadQdnDataset,
  loadPost,
  normalizeAddressList,
  normalizePrincipal,
  normalizeQortalAddress,
  publishJsonResource,
  publishJsonResources,
  publishMediaWithIndex,
  qdnLink,
  saveLocalDataset,
  slugify,
  toPostIndexItem
} from './cmsRepository';
import { fetchQdnResource, getQdnResourceStatus, getQdnResourceUrl, hasQortalBridge, requestQortal, toBase64, tryRequestQortal } from './qortalClient';
import { parseVideoLink } from './videoLinks';
import type { CmsComment, CmsDataset, CmsMediaItem, CmsPost, CmsPostIndexItem, CmsStatus, CmsVideoEmbed, QdnRef, ViewerIdentity } from './types';
import './styles.css';

type Section = 'dashboard' | 'posts' | 'media' | 'imported' | 'settings';
type EditorMode = 'preview' | 'edit';
const IMPORT_BATCH_LIMIT = 10;

interface ImportedIndexItem {
  type: 'post';
  source_id: number;
  old_url: string;
  slug: string;
  title: string;
  date: string;
  modified: string;
  status: string;
  file: string;
}

interface ImportedTerm {
  source_id: number;
  name: string;
  slug: string;
}

interface ImportedAttachment {
  title?: string;
  source_url?: string;
  media_type?: string;
  mime_type?: string;
}

interface ImportedPost {
  type: 'post';
  source_id: number;
  old_url: string;
  slug: string;
  title: string;
  date: string;
  modified: string;
  status: string;
  excerpt: string;
  excerpt_text?: string;
  content_html: string;
  categories: number[];
  tags: number[];
  attachments?: ImportedAttachment[];
  import?: { importer_version?: string; imported_at?: string };
}

interface ImportedMediaMapItem {
  type: 'image' | 'audio' | 'video' | 'document' | 'file';
  local_path: string;
  qdn_service?: string;
  qdn_identifier?: string | null;
  mime_type?: string;
  title?: string;
  bytes?: number;
}

type ImportedMediaMap = Record<string, ImportedMediaMapItem>;

interface ImportedQdnManifest {
  version: string;
  generated_at: string;
  entrypoints: Record<string, QdnRef>;
  resources: {
    by_path?: Record<string, QdnRef>;
  };
}

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

function readableError(value: unknown, fallback = 'Unexpected Qortal error.') {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === 'string' && value.trim()) return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== '{}' ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function shortHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function safeIdPart(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'item';
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
    videos: [],
    comments_enabled: true,
    author: { name: ownerName || 'local-owner', address: ownerAddress }
  };
}

function listFromText(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function lastTermFragment(value: string) {
  const parts = value.split(',');
  return (parts[parts.length - 1] || '').trim().toLowerCase();
}

function appendTerm(value: string, termName: string) {
  const existing = listFromText(value);
  if (existing.some((item) => item.toLowerCase() === termName.toLowerCase())) {
    return value;
  }

  const prefix = value.trim().endsWith(',') ? value : existing.slice(0, -1).join(', ');
  return [prefix, termName].filter(Boolean).join(prefix ? ', ' : '');
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

function sameQdnRef(left: QdnRef, right: QdnRef) {
  return left.service === right.service && left.name === right.name && left.identifier === right.identifier;
}

function findMediaItem(media: CmsMediaItem[], ref: QdnRef) {
  return media.find((item) => sameQdnRef(item.qdn, ref)) || null;
}

function mergeMediaItems(existing: CmsMediaItem[], incoming: CmsMediaItem[]) {
  const next = [...existing];
  for (const item of incoming) {
    if (!next.some((current) => sameQdnRef(current.qdn, item.qdn))) {
      next.push(item);
    }
  }
  return next;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function TermInput({
  label,
  value,
  onChange,
  placeholder,
  terms
}: {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  terms: CmsDataset['categories'];
}) {
  const selected = listFromText(value).map((item) => item.toLowerCase());
  const fragment = lastTermFragment(value);
  const suggestions = terms
    .filter((term) => !selected.includes(term.name.toLowerCase()))
    .filter((term) => !fragment || term.name.toLowerCase().includes(fragment))
    .slice(0, 8);

  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {suggestions.length > 0 && (
        <div className="term-suggestions">
          {suggestions.map((term) => (
            <button key={term.id} type="button" onClick={() => onChange(appendTerm(value, term.name))}>
              {term.name}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function LazyVideoEmbed({ video }: { video: CmsVideoEmbed }) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Not loaded');
  const url = qdnLink(video.qdn);

  async function loadVideo() {
    setStatus('Checking QDN status...');
    const qdnStatus = await getQdnResourceStatus(video.qdn.service, video.qdn.name || '', video.qdn.identifier, true);
    if (qdnStatus?.status) {
      const percent = qdnStatus.percentLoaded !== undefined ? ` ${qdnStatus.percentLoaded}%` : '';
      setStatus(`${qdnStatus.status}${percent}`);
    } else {
      setStatus('Loading from QDN...');
    }
    setActive(true);
  }

  return (
    <article className="video-embed-card">
      <div>
        <strong>{video.title}</strong>
        <span>{video.source} · {video.qdn.name} · {video.qdn.identifier}</span>
      </div>
      {active ? (
        <video controls preload="metadata" src={url} />
      ) : (
        <button className="video-load-button" type="button" onClick={loadVideo}>
          <Play size={18} /> Load video
        </button>
      )}
      <div className="quick-actions video-actions">
        <button type="button" onClick={loadVideo} title="Load video"><Play size={16} /><span>Load</span></button>
        <a href={url} target="_blank" rel="noreferrer" title="Open QDN video"><Link size={16} /><span>Open</span></a>
        <button type="button" onClick={() => void copyText(toQortalUri(video.qdn))} title="Copy QDN URI"><Copy size={16} /><span>Copy</span></button>
      </div>
      <small>{status}</small>
    </article>
  );
}

function isTextMedia(item: CmsMediaItem) {
  const filename = item.filename.toLowerCase();
  return item.mime_type.startsWith('text/') || filename.endsWith('.md') || filename.endsWith('.txt');
}

function downloadResource(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function toQortalUri(ref: QdnRef) {
  return ref.name ? `qortal://${ref.service}/${ref.name}/${ref.identifier}` : '';
}

function withQdnName(ref: QdnRef, name: string): QdnRef {
  return { ...ref, name: ref.name || name };
}

async function copyText(value: string) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function MediaAttachmentViewer({ items }: { items: CmsMediaItem[] }) {
  const [urlsById, setUrlsById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [previewItem, setPreviewItem] = useState<CmsMediaItem | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function resolveUrls() {
      setLoading(true);
      const entries = await Promise.all(items.map(async (item) => {
        if (!item.qdn.name) return [item.id, ''] as const;
        try {
          const url = await getQdnResourceUrl(item.qdn.service, item.qdn.name, item.qdn.identifier, item.filename);
          return [item.id, url] as const;
        } catch {
          return [item.id, qdnLink(item.qdn)] as const;
        }
      }));

      if (!active) return;
      setUrlsById(Object.fromEntries(entries));
      setLoading(false);
    }

    if (items.length > 0) {
      void resolveUrls();
    } else {
      setUrlsById({});
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [items]);

  useEffect(() => {
    if (!previewItem || !isTextMedia(previewItem)) return;
    const url = urlsById[previewItem.id];

    if (!url) {
      if (!loading) setPreviewError('Unable to resolve QDN resource URL.');
      return;
    }

    let active = true;

    async function loadTextPreview() {
      setPreviewLoading(true);
      setPreviewError('');
      setPreviewText('');

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to load file: ${response.status}`);
        const text = await response.text();
        if (active) setPreviewText(text);
      } catch (error) {
        if (active) setPreviewError((error as Error).message || 'Unable to load file preview.');
      } finally {
        if (active) setPreviewLoading(false);
      }
    }

    void loadTextPreview();

    return () => {
      active = false;
    };
  }, [loading, previewItem, urlsById]);

  if (items.length === 0) return null;

  return (
    <section className="attachments-panel">
      <div className="panel-title"><Paperclip size={18} /><h3>Attachments</h3><span>{items.length}</span></div>
      <div className="attachment-list">
        {items.map((item) => {
          const url = urlsById[item.id];
          const canPreviewText = isTextMedia(item);

          return (
            <article key={item.id} className={item.type === 'image' ? 'attachment-card image-attachment' : 'attachment-card'}>
              {item.type === 'image' && url ? <img src={url} alt="" loading="lazy" /> : <FileText size={18} />}
              <div>
                <strong>{item.title}</strong>
                <small>{item.type} · {item.filename} · {formatBytes(item.bytes)}</small>
              </div>
              <div className="attachment-actions">
                {url ? (
                  <>
                    {(item.type === 'image' || canPreviewText) && (
                      <button type="button" onClick={() => setPreviewItem(item)}><Eye size={15} /> View</button>
                    )}
                    <a href={url} target="_blank" rel="noreferrer"><Link size={15} /> Open</a>
                    <button type="button" onClick={() => downloadResource(url, item.filename)}><Download size={15} /> Download</button>
                  </>
                ) : (
                  <span>{loading ? 'Loading...' : 'Unavailable'}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {previewItem && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPreviewItem(null)}>
          <div className="media-preview-modal" role="dialog" aria-modal="true" aria-label="Attachment preview" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <strong>{previewItem.filename}</strong>
              <button type="button" onClick={() => setPreviewItem(null)}><XCircle size={18} /> Close</button>
            </div>
            {previewItem.type === 'image' ? (
              <img className="media-preview-image" src={urlsById[previewItem.id]} alt="" />
            ) : previewLoading ? (
              <p>Loading preview...</p>
            ) : previewError ? (
              <p className="preview-error">{previewError}</p>
            ) : (
              <pre className="text-file-preview">{previewText}</pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
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
  const [mediaTitleDraft, setMediaTitleDraft] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [videoLinkDraft, setVideoLinkDraft] = useState('');
  const [videoTitleDraft, setVideoTitleDraft] = useState('');
  const [coauthorAddressDraft, setCoauthorAddressDraft] = useState('');
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [tipBalance, setTipBalance] = useState<number | null>(null);
  const [tipRecipient, setTipRecipient] = useState('');
  const [tipError, setTipError] = useState('');
  const [tipSending, setTipSending] = useState(false);
  const [importOwnerName, setImportOwnerName] = useState(qdnName);
  const [importManifestIdentifier, setImportManifestIdentifier] = useState('cr-qdn-manifest');
  const [importedManifest, setImportedManifest] = useState<ImportedQdnManifest | null>(null);
  const [importedPosts, setImportedPosts] = useState<ImportedIndexItem[]>([]);
  const [importedCategories, setImportedCategories] = useState<ImportedTerm[]>([]);
  const [importedTags, setImportedTags] = useState<ImportedTerm[]>([]);
  const [importedMediaMap, setImportedMediaMap] = useState<ImportedMediaMap>({});
  const [selectedImportedPost, setSelectedImportedPost] = useState<ImportedPost | null>(null);
  const [selectedImportedIndex, setSelectedImportedIndex] = useState<ImportedIndexItem | null>(null);
  const [selectedImportedIds, setSelectedImportedIds] = useState<number[]>([]);
  const [publicDetailOpen, setPublicDetailOpen] = useState(false);
  const [forcePublicView, setForcePublicView] = useState(false);
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
    const initialIdentity = await getViewerIdentity(qdnName);
    const ownerCandidates = [
      qdnName,
      ...initialIdentity.names
    ].map((name) => name.trim()).filter(Boolean);
    const uniqueOwnerCandidates = [...new Set(ownerCandidates.map((name) => normalizePrincipal(name)))];
    const ownerCandidateByNormalized = new Map(ownerCandidates.map((name) => [normalizePrincipal(name), name]));
    let loadedDataset: CmsDataset | null = null;

    for (const normalizedName of uniqueOwnerCandidates) {
      const candidate = ownerCandidateByNormalized.get(normalizedName) || normalizedName;
      loadedDataset = await loadQdnDataset(candidate);
      if (loadedDataset) break;
    }

    loadedDataset ||= await loadDataset(qdnName || initialIdentity.name);
    const ownerName = qdnName || loadedDataset.manifest.owner_name || initialIdentity.name;
    const viewerIdentity = await getViewerIdentity(ownerName, loadedDataset.manifest);
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

  const isSysop = identity?.role === 'sysop';
  const canManageContent = identity?.role === 'sysop' || identity?.role === 'coauthor';
  const canComment = Boolean(identity?.bridgeAvailable && identity.name && selectedPost?.comments_enabled);
  const commentsForPost = useMemo(() => {
    return (dataset?.comments || []).filter((comment) => comment.post_id === selectedPost?.id && comment.status === 'published');
  }, [dataset?.comments, selectedPost?.id]);

  const visiblePosts = useMemo(() => {
    const posts = dataset?.posts || [];
    return canManageContent ? posts : posts.filter((post) => post.status === 'published');
  }, [canManageContent, dataset?.posts]);

  useEffect(() => {
    if (!selectedPost || !identity?.bridgeAvailable) return;
    fetchPostLikeCount(selectedPost.id).then((count) => {
      setLikeCounts((current) => ({ ...current, [selectedPost.id]: count }));
    }).catch(() => {
      setLikeCounts((current) => ({ ...current, [selectedPost.id]: current[selectedPost.id] || 0 }));
    });
  }, [identity?.bridgeAvailable, selectedPost?.id]);

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return visiblePosts.filter((post) => {
      const matchesSearch = !normalized || `${post.title} ${post.slug} ${post.excerpt}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [query, statusFilter, visiblePosts]);

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

  async function fetchPostLikeCount(postId: string) {
    const response = await tryRequestQortal<unknown[]>({
      action: 'SEARCH_QDN_RESOURCES',
      service: 'DOCUMENT',
      mode: 'ALL',
      identifier: `cms-like-${shortHash(postId)}-`,
      prefix: true,
      limit: 100,
      offset: 0,
      reverse: true,
      includeMetadata: false,
      excludeBlocked: true
    });
    return Array.isArray(response) ? response.length : 0;
  }

  async function likeSelectedPost() {
    if (!selectedPost || !identity?.name || !identity.address) {
      setStatus('A logged-in Qortal name is required to like posts.');
      return;
    }
    const identifier = `cms-like-${shortHash(selectedPost.id)}-${safeIdPart(identity.name || identity.address)}`;
    const payload = {
      id: identifier,
      identifier,
      post_id: selectedPost.id,
      post_identifier: selectedPost.qdn.identifier,
      author_name: identity.name,
      author_address: identity.address,
      created_at: new Date().toISOString()
    };

    try {
      setStatus('Publishing like...');
      await requestQortal({
        action: 'PUBLISH_QDN_RESOURCE',
        name: identity.name,
        service: 'DOCUMENT',
        identifier,
        data64: toBase64(JSON.stringify(payload, null, 2)),
        encoding: 'base64',
        title: `Like on ${selectedPost.title}`.slice(0, 55),
        description: 'CMS post like'
      });
      setLikeCounts((current) => ({ ...current, [selectedPost.id]: (current[selectedPost.id] || 0) + 1 }));
      setStatus('Post liked.');
    } catch (likeError) {
      setError((likeError as Error).message);
      setStatus('');
    }
  }

  function startNewPost() {
    if (!dataset || !identity) return;
    const cmsSiteName = dataset.manifest.owner_name || qdnName || identity.name;
    const post = emptyPost(identity.name || cmsSiteName, identity.address);
    post.cms_site_name = cmsSiteName;
    setSelectedIndex(toPostIndexItem(post));
    setSelectedPost(post);
    setDraft(createDraft(post));
    setEditorMode('edit');
    setSection('posts');
    setStatus('New post draft created.');
  }

  function applyDraft(statusOverride?: CmsStatus): { post: CmsPost; nextDataset: CmsDataset } | null {
    if (!dataset || !selectedPost || !draft || !identity) return null;
    const slug = slugify(draft.slug || draft.title);
    const categoryResult = termsFromText(draft.categoryText, dataset.categories);
    const tagResult = termsFromText(draft.tagText, dataset.tags);
    const updatedAt = new Date().toISOString();
    const cmsSiteName = dataset.manifest.owner_name || qdnName || identity.name;
    const post: CmsPost = {
      ...selectedPost,
      cms_site_name: cmsSiteName,
      title: draft.title,
      slug,
      excerpt: draft.excerpt,
      content_html: draft.content_html,
      status: statusOverride || draft.status,
      category_ids: categoryResult.ids,
      tag_ids: tagResult.ids,
      comments_enabled: draft.comments_enabled,
      updated_at: updatedAt,
      published_at: (statusOverride || draft.status) === 'published' ? selectedPost.published_at || updatedAt : selectedPost.published_at,
      qdn: {
        ...selectedPost.qdn,
        name: selectedPost.qdn.name || identity.name || cmsSiteName,
        identifier: selectedPost.qdn.identifier || createPostIdentifier(slug)
      },
      author: selectedPost.author.name && selectedPost.id !== 'sample-post' ? selectedPost.author : { name: identity.name, address: identity.address }
    };
    const index = toPostIndexItem(post);
    const exists = dataset.posts.some((item) => item.id === index.id);
    const posts = exists
      ? dataset.posts.map((item) => item.id === index.id ? index : item)
      : [index, ...dataset.posts];
    const nextDataset: CmsDataset = {
      ...dataset,
      manifest: { ...dataset.manifest, updated_at: updatedAt, owner_name: cmsSiteName, owner_address: dataset.manifest.owner_address || identity.address },
      posts,
      categories: categoryResult.terms,
      tags: tagResult.terms,
      media: dataset.media,
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
    setStatus('Local draft saved in this browser.');
  }

  async function publishPost(statusOverride?: CmsStatus) {
    if (!dataset || !identity || !canManageContent) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI dev mode to publish.');
      return;
    }
    const applied = applyDraft(statusOverride);
    if (!applied) return;

    const cmsSiteName = dataset.manifest.owner_name || qdnName || identity.name;
    const publishName = isSysop ? cmsSiteName : identity.name;
    if (!cmsSiteName || !publishName) {
      setError('Missing Qortal name. Publishing requires a logged-in Qortal account with a registered name.');
      return;
    }
    const postToPublish: CmsPost = {
      ...applied.post,
      cms_site_name: cmsSiteName,
      qdn: { ...applied.post.qdn, service: 'DOCUMENT', name: publishName }
    };
    const postIndex = toPostIndexItem(postToPublish);
    const posts = applied.nextDataset.posts.some((item) => item.id === postIndex.id)
      ? applied.nextDataset.posts.map((item) => item.id === postIndex.id ? postIndex : item)
      : [postIndex, ...applied.nextDataset.posts];
    const nextDataset: CmsDataset = {
      ...applied.nextDataset,
      manifest: { ...applied.nextDataset.manifest, owner_name: cmsSiteName, owner_address: applied.nextDataset.manifest.owner_address || identity.address },
      posts,
      local_posts: { ...(applied.nextDataset.local_posts || {}), [postToPublish.id]: postToPublish }
    };

    setError(null);
    try {
      setStatus(`${postToPublish.status === 'published' ? 'Publishing post' : 'Saving QDN draft'}${isSysop ? ' and updating CMS indexes' : ''}...`);
      const publishItems: Parameters<typeof publishJsonResources>[1] = [
        {
          ref: postToPublish.qdn,
          data: postToPublish,
          title: postToPublish.title,
          description: stripHtml(postToPublish.excerpt || postToPublish.content_html).slice(0, 4000)
        }
      ];

      if (isSysop) {
        publishItems.push(
          { ref: { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER }, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
          { ref: { service: 'DOCUMENT', identifier: PAGES_INDEX_IDENTIFIER }, data: nextDataset.pages, title: 'CMS pages index', description: 'Qortal CMS pages index' },
          { ref: { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER }, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
          { ref: { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER }, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
          { ref: { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER }, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
          { ref: { service: 'DOCUMENT', identifier: COMMENTS_INDEX_IDENTIFIER }, data: nextDataset.comments, title: 'CMS comments index', description: 'Qortal CMS comments index' },
          { ref: { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER }, data: nextDataset.manifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
        );
      }

      await publishJsonResources(publishName, publishItems);

      setDataset(nextDataset);
      setSelectedPost(postToPublish);
      setSelectedIndex(postIndex);
      saveLocalDataset(nextDataset);
      setDraft(createDraft(postToPublish));
      setStatus(postToPublish.status === 'published' ? 'Published to QDN.' : 'Draft saved to QDN.');
    } catch (publishError) {
      setError(readableError(publishError, 'Qortal publish failed. Check that the logged-in account owns the publish target name.'));
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
      media: [],
      local_posts: {}
    };
    setDataset(nextDataset);
    saveLocalDataset(nextDataset);
    setSelectedIndex(null);
    setSelectedPost(null);
    setDraft(null);
    setStatus('Local CMS dataset initialized.');
  }

  async function publishManifestUpdate(nextDataset: CmsDataset) {
    const ownerName = qdnName || nextDataset.manifest.owner_name || identity?.name || '';
    if (!ownerName) throw new Error('Missing owner Qortal name.');
    if (!hasQortalBridge()) throw new Error('Qortal bridge is not available. Open through Qortal UI dev mode.');

    await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER, name: ownerName }, nextDataset.manifest, 'CMS manifest', 'Qortal CMS manifest');
  }

  async function addCoauthor() {
    if (!dataset || !identity || !isSysop) return;
    const address = normalizeQortalAddress(coauthorAddressDraft);
    if (!address) {
      setError('Enter a wallet address or Qortal name before adding a coauthor.');
      return;
    }
    if (address === identity.address) {
      setError('The SysOp address does not need to be added as a coauthor.');
      return;
    }

    const nextManifest = {
      ...dataset.manifest,
      owner_address: dataset.manifest.owner_address || identity.address,
      coauthors: normalizeAddressList([...(dataset.manifest.coauthors || []), address]),
      updated_at: new Date().toISOString()
    };
    const nextDataset = { ...dataset, manifest: nextManifest };

    setError(null);
    try {
      setStatus('Publishing coauthor registry...');
      await publishManifestUpdate(nextDataset);
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setCoauthorAddressDraft('');
      setStatus('Coauthor added.');
    } catch (coauthorError) {
      setError((coauthorError as Error).message);
      setStatus('');
    }
  }

  async function removeCoauthor(address: string) {
    if (!dataset || !identity || !isSysop) return;
    const normalized = normalizeQortalAddress(address);
    const nextManifest = {
      ...dataset.manifest,
      coauthors: normalizeAddressList(dataset.manifest.coauthors || []).filter((item) => item !== normalized),
      updated_at: new Date().toISOString()
    };
    const nextDataset = { ...dataset, manifest: nextManifest };

    setError(null);
    try {
      setStatus('Publishing coauthor registry...');
      await publishManifestUpdate(nextDataset);
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setStatus('Coauthor removed.');
    } catch (coauthorError) {
      setError((coauthorError as Error).message);
      setStatus('');
    }
  }

  async function loadImportedManifest() {
    const ownerName = (importOwnerName || qdnName || dataset?.manifest.owner_name || '').trim();
    const identifier = importManifestIdentifier.trim() || 'cr-qdn-manifest';
    if (!ownerName) {
      setError('Enter importer owner name before loading imported content.');
      return;
    }

    setError(null);
    try {
      setStatus('Loading imported QDN manifest...');
      const manifest = await fetchQdnResource<ImportedQdnManifest>('DOCUMENT', ownerName, identifier);
      const postsRef = withQdnName(manifest.entrypoints.posts_index, ownerName);
      const categoriesRef = withQdnName(manifest.entrypoints.categories, ownerName);
      const tagsRef = withQdnName(manifest.entrypoints.tags, ownerName);
      const mediaMapRef = manifest.entrypoints.media_map ? withQdnName(manifest.entrypoints.media_map, ownerName) : null;
      const [posts, categories, tags, mediaMap] = await Promise.all([
        fetchQdnResource<ImportedIndexItem[]>(postsRef.service, postsRef.name || ownerName, postsRef.identifier),
        fetchQdnResource<ImportedTerm[]>(categoriesRef.service, categoriesRef.name || ownerName, categoriesRef.identifier).catch(() => []),
        fetchQdnResource<ImportedTerm[]>(tagsRef.service, tagsRef.name || ownerName, tagsRef.identifier).catch(() => []),
        mediaMapRef
          ? fetchQdnResource<ImportedMediaMap>(mediaMapRef.service, mediaMapRef.name || ownerName, mediaMapRef.identifier).catch(() => ({}))
          : Promise.resolve({})
      ]);

      setImportedManifest(manifest);
      setImportedPosts(posts);
      setImportedCategories(categories);
      setImportedTags(tags);
      setImportedMediaMap(mediaMap);
      setSelectedImportedPost(null);
      setSelectedImportedIndex(null);
      setSelectedImportedIds([]);
      setStatus(`Imported content loaded: ${posts.length} posts.`);
    } catch (importError) {
      setError((importError as Error).message);
      setStatus('');
    }
  }

  function importedPostRef(index: ImportedIndexItem): QdnRef | null {
    const key = `converted/${index.file}`;
    return importedManifest?.resources.by_path?.[key] || null;
  }

  async function previewImportedPost(index: ImportedIndexItem) {
    const ownerName = (importOwnerName || qdnName || dataset?.manifest.owner_name || '').trim();
    const ref = importedPostRef(index);
    if (!ownerName || !ref) {
      setError('Imported post QDN resource was not found in manifest.');
      return;
    }

    setError(null);
    try {
      setStatus('Loading imported post preview...');
      const post = await fetchQdnResource<ImportedPost>(ref.service, ref.name || ownerName, ref.identifier);
      setSelectedImportedPost(post);
      setSelectedImportedIndex(index);
      setStatus('Imported post loaded.');
    } catch (previewError) {
      setError((previewError as Error).message);
      setStatus('');
    }
  }

  function importedTermNames(ids: number[], terms: ImportedTerm[]) {
    return ids
      .map((id) => terms.find((term) => term.source_id === id)?.name)
      .filter(Boolean) as string[];
  }

  function importedMediaRef(mediaItem: ImportedMediaMapItem, ownerName: string): QdnRef | null {
    const pathRef = importedManifest?.resources.by_path?.[mediaItem.local_path];
    if (pathRef) return withQdnName(pathRef, ownerName);
    if (mediaItem.qdn_service && mediaItem.qdn_identifier) {
      return { service: mediaItem.qdn_service, identifier: mediaItem.qdn_identifier, name: ownerName };
    }
    return null;
  }

  function attachmentMediaItem(attachment: ImportedAttachment) {
    if (!attachment.source_url) return null;
    return importedMediaMap[attachment.source_url] || null;
  }

  function importedAttachmentSummary(post: ImportedPost, ownerName: string) {
    return (post.attachments || []).map((attachment) => {
      const mediaItem = attachmentMediaItem(attachment);
      const qdn = mediaItem ? importedMediaRef(mediaItem, ownerName) : null;
      return { attachment, mediaItem, qdn };
    });
  }

  function toCmsMediaType(value: ImportedMediaMapItem['type']) {
    if (value === 'image' || value === 'audio' || value === 'video' || value === 'document') return value;
    return 'file';
  }

  function cmsMediaFromImported(mediaItem: ImportedMediaMapItem, qdn: QdnRef, ownerName: string, author: ViewerIdentity, now: string): CmsMediaItem {
    const filename = mediaItem.local_path.split('/').pop() || `${qdn.identifier}.bin`;
    return {
      schema: 'qortal-cms/media@1',
      id: `imported-media-${shortHash(`${qdn.service}:${qdn.name || ownerName}:${qdn.identifier}`)}`,
      type: toCmsMediaType(mediaItem.type),
      title: mediaItem.title || filename,
      filename,
      mime_type: mediaItem.mime_type || '',
      bytes: mediaItem.bytes || 0,
      created_at: now,
      updated_at: now,
      author: { name: author.name || ownerName, address: author.address },
      qdn
    };
  }

  function buildCmsPostFromImported(
    importedPost: ImportedPost,
    baseCategories: CmsDataset['categories'],
    baseTags: CmsDataset['tags'],
    ownerName: string,
    author: ViewerIdentity,
    now: string,
    existing?: CmsPostIndexItem
  ) {
    const categoryNames = importedTermNames(importedPost.categories || [], importedCategories);
    const tagNames = importedTermNames(importedPost.tags || [], importedTags);
    const categoryResult = termsFromText(categoryNames.join(', '), baseCategories);
    const tagResult = termsFromText(tagNames.join(', '), baseTags);
    const slug = slugify(importedPost.slug || importedPost.title);
    const importedMedia = importedAttachmentSummary(importedPost, ownerName)
      .filter((item): item is { attachment: ImportedAttachment; mediaItem: ImportedMediaMapItem; qdn: QdnRef } => Boolean(item.mediaItem && item.qdn));
    const attachedMedia = importedMedia
      .filter((item) => item.mediaItem.type !== 'video')
      .map((item) => item.qdn);
    const videos: CmsVideoEmbed[] = importedMedia
      .filter((item) => item.mediaItem.type === 'video')
      .map((item) => ({
        id: `imported-video-${shortHash(item.qdn.identifier)}`,
        title: item.attachment.title || item.mediaItem.title || item.mediaItem.local_path.split('/').pop() || 'Imported video',
        source: 'qdn',
        source_url: toQortalUri(item.qdn),
        created_at: now,
        qdn: item.qdn
      }));
    const mediaItems = importedMedia.map((item) => cmsMediaFromImported(item.mediaItem, item.qdn, ownerName, author, now));
    const post: CmsPost = {
      schema: 'qortal-cms/post@1',
      id: `wp-${importedPost.source_id}`,
      type: 'post',
      title: decodeText(importedPost.title),
      slug,
      status: 'draft',
      excerpt: importedPost.excerpt_text || stripHtml(importedPost.excerpt || '').slice(0, 500),
      category_ids: categoryResult.ids,
      tag_ids: tagResult.ids,
      cms_site_name: ownerName,
      created_at: importedPost.date || now,
      updated_at: now,
      published_at: null,
      qdn: existing?.qdn || { service: 'DOCUMENT', identifier: createPostIdentifier(slug), name: ownerName },
      content_html: `${importedPost.content_html || ''}<hr/><p><small>Imported from WordPress source ID ${importedPost.source_id}. Original URL: <a href="${importedPost.old_url}" target="_blank" rel="noreferrer">${importedPost.old_url}</a></small></p>`,
      featured_image: mediaItems.find((item) => item.type === 'image')?.qdn || null,
      media: attachedMedia,
      videos,
      comments_enabled: true,
      author: { name: author.name || ownerName, address: author.address }
    };

    return { post, categories: categoryResult.terms, tags: tagResult.terms, mediaItems, index: toPostIndexItem(post) };
  }

  async function fetchImportedPost(index: ImportedIndexItem, ownerName: string) {
    const ref = importedPostRef(index);
    if (!ref) {
      throw new Error(`Imported post resource missing from manifest: ${index.title}`);
    }
    return fetchQdnResource<ImportedPost>(ref.service, ref.name || ownerName, ref.identifier);
  }

  function toggleImportedSelection(sourceId: number) {
    setSelectedImportedIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((id) => id !== sourceId);
      }
      if (current.length >= IMPORT_BATCH_LIMIT) {
        setStatus(`Batch limit is ${IMPORT_BATCH_LIMIT} imported posts at once.`);
        return current;
      }
      return [...current, sourceId];
    });
  }

  function selectVisibleImportedPosts() {
    if (!dataset) return;
    const ids = importedPosts
      .filter((post) => !dataset.posts.some((item) => item.id === `wp-${post.source_id}`))
      .slice(0, IMPORT_BATCH_LIMIT)
      .map((post) => post.source_id);
    setSelectedImportedIds(ids);
    setStatus(ids.length ? `${ids.length} imported posts selected.` : 'No unadopted imported posts to select.');
  }

  async function adoptImportedPost() {
    if (!dataset || !identity || !canManageContent || !selectedImportedPost) return;
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    if (!ownerName) {
      setError('Missing owner Qortal name.');
      return;
    }

    const existing = dataset.posts.find((post) => post.id === `wp-${selectedImportedPost.source_id}`);
    const now = new Date().toISOString();
    const { post, categories, tags, mediaItems, index } = buildCmsPostFromImported(selectedImportedPost, dataset.categories, dataset.tags, ownerName, identity, now, existing);
    const posts = existing
      ? dataset.posts.map((item) => item.id === index.id ? index : item)
      : [index, ...dataset.posts];
    const nextDataset: CmsDataset = {
      ...dataset,
      manifest: { ...dataset.manifest, updated_at: now, owner_name: ownerName, owner_address: dataset.manifest.owner_address || identity.address },
      posts,
      categories,
      tags,
      media: mergeMediaItems(dataset.media, mediaItems),
      local_posts: { ...(dataset.local_posts || {}), [post.id]: post }
    };

    setError(null);
    try {
      setStatus('Adopting imported post as CMS draft...');
      await publishJsonResources(ownerName, [
        { ref: post.qdn, data: post, title: post.title, description: stripHtml(post.excerpt || post.content_html).slice(0, 4000) },
        { ref: { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER }, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER }, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
        { ref: { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER }, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
        { ref: { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER }, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
        { ref: { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER }, data: nextDataset.manifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ]);
      setDataset(nextDataset);
      setSelectedPost(post);
      setSelectedIndex(index);
      setDraft(createDraft(post));
      setEditorMode('preview');
      saveLocalDataset(nextDataset);
      setStatus('Imported post adopted as CMS draft.');
    } catch (adoptError) {
      setError((adoptError as Error).message);
      setStatus('');
    }
  }

  async function adoptSelectedImportedPosts() {
    if (!dataset || !identity || !canManageContent || selectedImportedIds.length === 0) return;
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    if (!ownerName) {
      setError('Missing owner Qortal name.');
      return;
    }

    const selectedIndexes = importedPosts
      .filter((post) => selectedImportedIds.includes(post.source_id))
      .filter((post) => !dataset.posts.some((item) => item.id === `wp-${post.source_id}`))
      .slice(0, IMPORT_BATCH_LIMIT);

    if (selectedIndexes.length === 0) {
      setStatus('Selected imported posts are already adopted.');
      return;
    }

    setError(null);
    try {
      setStatus(`Preparing ${selectedIndexes.length} imported posts...`);
      const now = new Date().toISOString();
      const importedIndexes: CmsPostIndexItem[] = [];
      let categories = [...dataset.categories];
      let tags = [...dataset.tags];
      const localPosts = { ...(dataset.local_posts || {}) };
      let media = [...dataset.media];
      const publishItems: Parameters<typeof publishJsonResources>[1] = [];
      let firstPost: CmsPost | null = null;

      for (const indexItem of selectedIndexes) {
        const importedPost = selectedImportedPost?.source_id === indexItem.source_id
          ? selectedImportedPost
          : await fetchImportedPost(indexItem, ownerName);
        const built = buildCmsPostFromImported(importedPost, categories, tags, ownerName, identity, now);
        importedIndexes.push(built.index);
        categories = built.categories;
        tags = built.tags;
        media = mergeMediaItems(media, built.mediaItems);
        localPosts[built.post.id] = built.post;
        if (!firstPost) firstPost = built.post;
        publishItems.push({
          ref: built.post.qdn,
          data: built.post,
          title: built.post.title,
          description: stripHtml(built.post.excerpt || built.post.content_html).slice(0, 4000)
        });
      }

      const nextDataset: CmsDataset = {
        ...dataset,
        manifest: { ...dataset.manifest, updated_at: now, owner_name: ownerName, owner_address: dataset.manifest.owner_address || identity.address },
        posts: [...importedIndexes, ...dataset.posts],
        categories,
        tags,
        media,
        local_posts: localPosts
      };

      setStatus(`Publishing ${selectedIndexes.length} imported CMS drafts...`);
      await publishJsonResources(ownerName, [
        ...publishItems,
        { ref: { service: 'DOCUMENT', identifier: POSTS_INDEX_IDENTIFIER }, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: { service: 'DOCUMENT', identifier: CATEGORIES_IDENTIFIER }, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
        { ref: { service: 'DOCUMENT', identifier: TAGS_IDENTIFIER }, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
        { ref: { service: 'DOCUMENT', identifier: MEDIA_INDEX_IDENTIFIER }, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
        { ref: { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER }, data: nextDataset.manifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ]);

      setDataset(nextDataset);
      if (firstPost) {
        setSelectedPost(firstPost);
        setSelectedIndex(toPostIndexItem(firstPost));
        setDraft(createDraft(firstPost));
        setEditorMode('preview');
      }
      setSelectedImportedIds([]);
      saveLocalDataset(nextDataset);
      setStatus(`${selectedIndexes.length} imported posts adopted as CMS drafts.`);
    } catch (batchError) {
      setError((batchError as Error).message);
      setStatus('');
    }
  }

  if (error && !dataset) return <div className="app-message error"><XCircle />{error}</div>;
  if (!dataset || !identity) return <div className="app-message"><RefreshCcw className="spin" />Loading Qortal CMS...</div>;

  const selectedCategoryNames = selectedPost?.category_ids.map((id) => dataset.categories.find((term) => term.id === id)?.name).filter(Boolean) || [];
  const selectedTagNames = selectedPost?.tag_ids.map((id) => dataset.tags.find((term) => term.id === id)?.name).filter(Boolean) || [];
  const selectedMediaItems = selectedPost ? selectedPost.media.map((ref) => findMediaItem(dataset.media, ref)).filter(Boolean) as CmsMediaItem[] : [];
  const ownerTarget = qdnName || dataset.manifest.owner_name || 'not set';
  const publicPosts = dataset.posts.filter((post) => post.status === 'published').slice(0, 8);
  const publicSelectedPost = selectedPost?.status === 'published' ? selectedPost : null;

  function cmsTermNames(ids: string[], terms: CmsDataset['categories']) {
    return ids.map((id) => terms.find((term) => term.id === id)?.name).filter(Boolean) as string[];
  }

  function publicExcerpt(post: CmsPostIndexItem) {
    return decodeText(stripHtml(post.excerpt || '')).slice(0, 500);
  }

  function formatDate(value: string) {
    return value ? new Date(value).toLocaleDateString() : 'No date';
  }

  async function openPublicPost(index: CmsPostIndexItem) {
    await openPost(index);
    setPublicDetailOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function copyPostQdnUri() {
    if (!selectedPost) return;
    const copied = await copyText(toQortalUri(selectedPost.qdn));
    setStatus(copied ? 'Post QDN URI copied.' : 'Unable to copy QDN URI.');
  }

  function postShareUrl() {
    if (!selectedPost || !dataset) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('name', qdnName || dataset.manifest.owner_name);
    url.searchParams.set('post', selectedPost.slug || selectedPost.id);
    return url.toString();
  }

  async function shareSelectedPost() {
    if (!selectedPost) return;
    const shareData = {
      title: selectedPost.title,
      text: stripHtml(selectedPost.excerpt || selectedPost.content_html).slice(0, 180),
      url: postShareUrl()
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setStatus('Share sheet opened.');
        return;
      }
      await copyText(shareData.url);
      setStatus('Post link copied.');
    } catch {
      setStatus('Share cancelled.');
    }
  }

  async function openTipModal() {
    if (!selectedPost) return;
    setTipOpen(true);
    setTipAmount('');
    setTipError('');
    setTipBalance(null);
    setTipRecipient('');

    try {
      const [balance, nameData] = await Promise.all([
        tryRequestQortal<number>({ action: 'GET_WALLET_BALANCE', coin: 'QORT' }),
        selectedPost.author.name ? tryRequestQortal<{ owner?: string }>({ action: 'GET_NAME_DATA', name: selectedPost.author.name }) : Promise.resolve(null)
      ]);
      setTipBalance(typeof balance === 'number' ? balance : null);
      setTipRecipient(nameData?.owner || selectedPost.author.address || '');
    } catch {
      setTipError('Unable to load wallet or recipient data.');
    }
  }

  async function sendTip() {
    const amount = Number(tipAmount);
    if (!tipRecipient) {
      setTipError('Recipient wallet address is unavailable.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setTipError('Enter a QORT amount greater than 0.');
      return;
    }
    if (typeof tipBalance === 'number' && amount > tipBalance) {
      setTipError('Entered amount is higher than your wallet balance.');
      return;
    }

    try {
      setTipSending(true);
      setTipError('');
      await requestQortal({ action: 'SEND_COIN', coin: 'QORT', recipient: tipRecipient, amount });
      setTipOpen(false);
      setTipAmount('');
      setStatus('Tip sent.');
    } catch (tipSendError) {
      setTipError((tipSendError as Error).message || 'Tip transfer failed.');
    } finally {
      setTipSending(false);
    }
  }

  function openPostQdnResource() {
    if (!selectedPost) return;
    const url = qdnLink(selectedPost.qdn);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  function scrollToComments() {
    document.getElementById('post-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function publishMediaFile() {
    if (!dataset || !identity || !canManageContent || !mediaFile) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI dev mode to publish media.');
      return;
    }
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    if (!ownerName) {
      setError('Missing owner Qortal name. Open with ?name=<QortalName>.');
      return;
    }

    const mediaItem = createMediaItem(mediaFile, ownerName, identity.address);
    mediaItem.title = mediaTitleDraft.trim() || mediaItem.title;
    const updatedManifest = {
      ...dataset.manifest,
      updated_at: new Date().toISOString(),
      owner_name: ownerName,
      owner_address: dataset.manifest.owner_address || identity.address
    };
    const nextMedia = [mediaItem, ...dataset.media];

    setError(null);
    try {
      setStatus('Publishing media and updating media index...');
      await publishMediaWithIndex(ownerName, mediaFile, mediaItem, nextMedia, updatedManifest);
      const nextDataset = { ...dataset, manifest: updatedManifest, media: nextMedia };
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setMediaFile(null);
      setMediaTitleDraft('');
      setStatus('Media published to QDN.');
    } catch (mediaError) {
      setError(readableError(mediaError, 'Qortal media publish failed. Check that the logged-in account owns the publish target name.'));
      setStatus('');
    }
  }

  function attachMediaToPost(mediaItem: CmsMediaItem) {
    if (!selectedPost) return;
    const exists = selectedPost.media.some((ref) => sameQdnRef(ref, mediaItem.qdn));
    if (exists) return;
    const nextPost = { ...selectedPost, media: [...selectedPost.media, mediaItem.qdn] };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost));
    setStatus('Media attached to current post. Save draft or publish to persist.');
  }

  function removeMediaFromPost(mediaItem: CmsMediaItem) {
    if (!selectedPost) return;
    const nextPost = { ...selectedPost, media: selectedPost.media.filter((ref) => !sameQdnRef(ref, mediaItem.qdn)) };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost));
    setStatus('Media removed from current post. Save draft or publish to persist.');
  }

  function addVideoEmbedToPost() {
    if (!selectedPost) return;
    const parsed = parseVideoLink(videoLinkDraft);
    if (!parsed) {
      setError('Paste a valid qortal://VIDEO, /arbitrary/VIDEO, qortal://APP/Q-Tube/video, or qortal://use-embed/VIDEO link.');
      return;
    }

    parsed.title = videoTitleDraft.trim() || parsed.title;
    const exists = (selectedPost.videos || []).some((video) => sameQdnRef(video.qdn, parsed.qdn));
    if (exists) {
      setError('This video is already attached to the post.');
      return;
    }

    const nextPost = { ...selectedPost, videos: [...(selectedPost.videos || []), parsed] };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost));
    setVideoLinkDraft('');
    setVideoTitleDraft('');
    setError(null);
    setStatus('Video attached to current post. Save draft or publish to persist.');
  }

  function removeVideoEmbedFromPost(video: CmsVideoEmbed) {
    if (!selectedPost) return;
    const nextPost = { ...selectedPost, videos: (selectedPost.videos || []).filter((item) => item.id !== video.id) };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost));
    setStatus('Video removed from current post. Save draft or publish to persist.');
  }

  if (!canManageContent || forcePublicView) {
    return (
      <main className="public-shell">
        <header className="public-header">
          <div>
            <p className="eyebrow">Qortal CMS</p>
            <h1>{dataset.manifest.title}</h1>
            <span>{publicPosts.length} published posts · owner {ownerTarget}</span>
          </div>
          <div className="public-status">
            <span>{identity.name ? `Viewing as ${identity.name}` : 'Read-only visitor'}</span>
            <span className={identity.bridgeAvailable ? 'ok' : 'muted'}>{identity.bridgeAvailable ? 'Qortal bridge available' : 'Browser preview'}</span>
            {canManageContent && (
              <button className="icon-command" type="button" onClick={() => setForcePublicView(false)}>
                <Settings size={16} /> Back to backend
              </button>
            )}
          </div>
        </header>

        {error && <div className="public-alert">{error}</div>}

        {!publicDetailOpen || !publicSelectedPost ? (
          <section className="public-home">
            <div className="public-section-title">
              <h2>Latest Posts</h2>
              <span>Showing 8 newest published posts</span>
            </div>
            <div className="public-post-grid">
              {publicPosts.map((post) => {
                const categoryNames = cmsTermNames(post.category_ids, dataset.categories);
                const tagNames = cmsTermNames(post.tag_ids, dataset.tags);
                return (
                  <article key={post.id} className="public-post-card">
                    <div className="public-card-meta">
                      <span>{formatDate(post.published_at || post.created_at)}</span>
                      <span>{post.type}</span>
                    </div>
                    <h3>{decodeText(post.title)}</h3>
                    <div className="public-term-stack">
                      <div><strong>Categories</strong><div className="chip-row">{categoryNames.length ? categoryNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}</div></div>
                      <div><strong>Tags</strong><div className="chip-row">{tagNames.length ? tagNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}</div></div>
                    </div>
                    <p>{publicExcerpt(post) || 'No excerpt available.'}</p>
                    <button className="icon-command primary" type="button" onClick={() => void openPublicPost(post)}>
                      <Eye size={16} /> Read more
                    </button>
                  </article>
                );
              })}
              {publicPosts.length === 0 && <div className="placeholder"><FileText size={22} /><strong>No published posts yet</strong><span>Published CMS posts will appear here for visitors.</span></div>}
            </div>
          </section>
        ) : (
          <section className="public-detail">
            <button className="icon-command public-back" type="button" onClick={() => setPublicDetailOpen(false)}>
              <FileText size={16} /> Back to posts
            </button>
            <article className="public-article">
              <div className="post-meta">
                <span>{formatDate(publicSelectedPost.published_at || publicSelectedPost.created_at)}</span>
                <span>{publicSelectedPost.author.name}</span>
                {publicSelectedPost.qdn.name && <a href={qdnLink(publicSelectedPost.qdn)} target="_blank" rel="noreferrer">QDN resource</a>}
              </div>
              <h2>{decodeText(publicSelectedPost.title)}</h2>
              {publicSelectedPost.excerpt && <p className="summary">{decodeText(publicSelectedPost.excerpt)}</p>}
              <div className="term-display">
                <div>
                  <strong>Categories</strong>
                  <div className="chip-row">
                    {selectedCategoryNames.length ? selectedCategoryNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}
                  </div>
                </div>
                <div>
                  <strong>Tags</strong>
                  <div className="chip-row">
                    {selectedTagNames.length ? selectedTagNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}
                  </div>
                </div>
              </div>
              <div className="content-preview" dangerouslySetInnerHTML={{ __html: publicSelectedPost.content_html }} />
              <MediaAttachmentViewer items={selectedMediaItems} />
              {(publicSelectedPost.videos || []).length > 0 && (
                <section className="attachments-panel">
                  <div className="panel-title"><Video size={18} /><h3>Videos</h3><span>{(publicSelectedPost.videos || []).length}</span></div>
                  <div className="video-embed-list">
                    {(publicSelectedPost.videos || []).map((video) => (
                      <LazyVideoEmbed key={video.id} video={video} />
                    ))}
                  </div>
                </section>
              )}
              <div className="quick-actions post-quick-actions" aria-label="Post quick actions">
                <button type="button" onClick={() => void likeSelectedPost()} title="Like post"><Heart size={16} /><span>{likeCounts[publicSelectedPost.id] || 0}</span></button>
                <button type="button" onClick={() => void shareSelectedPost()} title="Share post"><Share2 size={16} /><span>Share</span></button>
                <button type="button" onClick={() => void copyPostQdnUri()} disabled={!publicSelectedPost.qdn.name} title="Copy QDN URI"><Link size={16} /><span>Copy</span></button>
                <button type="button" onClick={() => void openTipModal()} title="Send tip"><Coins size={16} /><span>Tip</span></button>
                <button type="button" onClick={scrollToComments} title="Comments"><MessageSquare size={16} /><span>{commentsForPost.length}</span></button>
              </div>
            </article>

            <section id="post-comments" className="comments-panel public-comments">
              <div className="panel-title"><MessageSquare size={18} /><h3>Comments</h3><span>{commentsForPost.length}</span></div>
              {publicSelectedPost.comments_enabled ? (
                <>
                  {commentsForPost.map((comment) => (
                    <article key={comment.id} className="comment-card"><strong>{comment.author.name}</strong><span>{new Date(comment.updated_at).toLocaleString()}</span><div dangerouslySetInnerHTML={{ __html: comment.body_html }} />{identity.name === comment.author.name && <button className="text-button">Edit own comment ready</button>}</article>
                  ))}
                  <div className="comment-box"><RichTextEditor value={commentDraft} onChange={setCommentDraft} /><button className="icon-command" disabled={!canComment} onClick={publishComment}><Send size={16} /> Publish comment</button>{!canComment && <small>Commenting requires Qortal UI, a logged-in Qortal name, and comments enabled for this post.</small>}</div>
                </>
              ) : <p className="muted-text"><Lock size={16} /> Comments are disabled for this post.</p>}
            </section>
          </section>
        )}

        {tipOpen && (
          <div className="modal-backdrop" role="presentation" onClick={() => setTipOpen(false)}>
            <div className="media-preview-modal tip-modal" role="dialog" aria-modal="true" aria-label="Send QORT tip" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title">
                <strong>Send QORT Tip</strong>
                <button type="button" onClick={() => setTipOpen(false)}><XCircle size={18} /> Close</button>
              </div>
              <label>Recipient<input value={tipRecipient} readOnly /></label>
              <label>Amount<input value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} placeholder="0.1" inputMode="decimal" /></label>
              {typeof tipBalance === 'number' && <small>Available balance: {tipBalance} QORT</small>}
              {tipError && <p className="preview-error">{tipError}</p>}
              <button className="icon-command primary" type="button" disabled={tipSending} onClick={sendTip}><Coins size={16} /> {tipSending ? 'Sending...' : 'Send tip'}</button>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="cms-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p>Qortal CMS</p>
          <h1>{dataset.manifest.title}</h1>
          <span>Version {CMS_VERSION}</span>
        </div>

        <nav className="nav-list">
          <button onClick={() => setForcePublicView(true)}><Eye size={17} /> View site</button>
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
            <span>{isSysop ? 'SysOp controls enabled' : canManageContent ? 'Coauthor controls enabled' : 'Read-only mode'}</span>
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
          {canManageContent && <button className="icon-command primary" onClick={startNewPost}><Plus size={17} /> New</button>}
        </div>

        {section === 'dashboard' && (
          <div className="metric-grid">
            <div><strong>{visiblePosts.length}</strong><span>{canManageContent ? 'visible posts' : 'published posts'}</span></div>
            <div><strong>{dataset.posts.filter((post) => post.status === 'draft').length}</strong><span>drafts</span></div>
            <div><strong>{dataset.media.length}</strong><span>media</span></div>
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

        {section === 'media' && (
          <div className="media-library">
            {canManageContent && (
              <div className="media-uploader">
                <label>
                  Media file
                  <input type="file" onChange={(event) => setMediaFile(event.target.files?.[0] || null)} />
                </label>
                <label>
                  Title
                  <input value={mediaTitleDraft} onChange={(event) => setMediaTitleDraft(event.target.value)} placeholder={mediaFile?.name || 'Media title'} />
                </label>
                <button className="icon-command primary" disabled={!mediaFile} onClick={publishMediaFile}><Upload size={16} /> Publish media</button>
              </div>
            )}

            <div className="media-list">
              {dataset.media.map((item) => {
                const isAttached = selectedPost?.media.some((ref) => sameQdnRef(ref, item.qdn));
                return (
                  <article key={item.id} className="media-row">
                    {item.type === 'image' && <img className="media-thumb" src={qdnLink(item.qdn)} alt="" loading="lazy" />}
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.type} · {item.filename} · {formatBytes(item.bytes)}</span>
                    </div>
                    <div className="media-actions">
                      <a className="icon-command" href={qdnLink(item.qdn)} target="_blank" rel="noreferrer"><Link size={15} /> Open</a>
                      {canManageContent && selectedPost && (
                        <button className="icon-command" onClick={() => isAttached ? removeMediaFromPost(item) : attachMediaToPost(item)}>
                          <Paperclip size={15} /> {isAttached ? 'Detach' : 'Attach'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {dataset.media.length === 0 && <div className="placeholder"><Image size={22} /><strong>No media yet</strong><span>Publish images, audio, video, PDFs, or files from your computer.</span></div>}
            </div>
          </div>
        )}
        {section === 'imported' && (
          <div className="imported-panel">
            <div className="import-settings">
              <label>
                Importer owner name
                <input value={importOwnerName} onChange={(event) => setImportOwnerName(event.target.value)} placeholder="Qortal name that published the migrator manifest" />
              </label>
              <label>
                Manifest identifier
                <input value={importManifestIdentifier} onChange={(event) => setImportManifestIdentifier(event.target.value)} placeholder="cr-qdn-manifest" />
              </label>
              <button className="icon-command primary" type="button" onClick={loadImportedManifest}><RefreshCcw size={16} /> Load imported content</button>
            </div>

            {importedPosts.length > 0 && (
              <div className="import-batch-toolbar">
                <span>{selectedImportedIds.length} selected · max {IMPORT_BATCH_LIMIT}</span>
                <button className="icon-command" type="button" onClick={selectVisibleImportedPosts}><CheckCircle2 size={15} /> Select next drafts</button>
                <button className="icon-command" type="button" onClick={() => setSelectedImportedIds([])} disabled={selectedImportedIds.length === 0}><XCircle size={15} /> Clear</button>
                <button className="icon-command primary" type="button" onClick={adoptSelectedImportedPosts} disabled={!canManageContent || selectedImportedIds.length === 0}>
                  <Download size={15} /> Adopt selected
                </button>
              </div>
            )}

            <div className="imported-list">
              {importedPosts.map((post) => {
                const adopted = dataset.posts.some((item) => item.id === `wp-${post.source_id}`);
                const checked = selectedImportedIds.includes(post.source_id);
                return (
                  <article key={post.source_id} className={selectedImportedIndex?.source_id === post.source_id ? 'imported-row selected' : 'imported-row'}>
                    <input
                      aria-label={`Select ${decodeText(post.title)}`}
                      type="checkbox"
                      checked={checked}
                      disabled={adopted}
                      onChange={() => toggleImportedSelection(post.source_id)}
                    />
                    <button type="button" onClick={() => previewImportedPost(post)}>
                      <strong>{decodeText(post.title)}</strong>
                      <span>
                        {post.date ? new Date(post.date).toLocaleDateString() : 'no date'} ·{' '}
                        <strong className={adopted ? 'adoption-state adopted' : 'adoption-state pending'}>
                          {adopted ? 'adopted' : 'not adopted'}
                        </strong>
                      </span>
                    </button>
                  </article>
                );
              })}
              {importedPosts.length === 0 && <div className="placeholder"><Tags size={22} /><strong>No imported content loaded</strong><span>Load a migrator QDN manifest to review WordPress posts.</span></div>}
            </div>
          </div>
        )}
        {section === 'settings' && (
          <div className="settings-list">
            <p><strong>Owner name:</strong> {dataset.manifest.owner_name || qdnName || 'not set'}</p>
            <p><strong>Owner address:</strong> {dataset.manifest.owner_address || 'not set'}</p>
            <p><strong>Your role:</strong> {identity.role}</p>
            <p><strong>Manifest:</strong> DOCUMENT / {MANIFEST_IDENTIFIER}</p>
            <p><strong>Posts index:</strong> DOCUMENT / {POSTS_INDEX_IDENTIFIER}</p>

            <section className="coauthor-panel">
              <div className="panel-title"><User size={18} /><h3>Coauthors</h3><span>{dataset.manifest.coauthors.length}</span></div>
              <div className="coauthor-list">
                {dataset.manifest.coauthors.map((address) => (
                  <div key={address} className="coauthor-row">
                    <span>{address}</span>
                    {isSysop && <button type="button" onClick={() => removeCoauthor(address)}><Trash2 size={15} /> Remove</button>}
                  </div>
                ))}
                {dataset.manifest.coauthors.length === 0 && <small>No coauthors added yet.</small>}
              </div>

              {isSysop ? (
                <div className="coauthor-form">
                  <label>
                    Wallet address or Qortal name
                    <input value={coauthorAddressDraft} onChange={(event) => setCoauthorAddressDraft(event.target.value)} placeholder="Qortal wallet address or Qortal name" />
                  </label>
                  <button className="icon-command primary" type="button" onClick={addCoauthor}><Plus size={16} /> Add coauthor</button>
                </div>
              ) : (
                <small>Only the SysOp owner can add or remove coauthors.</small>
              )}
            </section>

            <button className="icon-command" onClick={initLocalSite}><RefreshCcw size={16} /> Reset local dataset</button>
          </div>
        )}
      </section>

      <section className="workspace">
        <div className="top-status">
          <span>{status || 'Ready'}</span>
          {error && <span className="error-text">{error}</span>}
          <span className={identity.bridgeAvailable ? 'ok' : 'muted'}>{identity.bridgeAvailable ? 'Qortal bridge available' : 'Browser preview only'}</span>
        </div>

        {section === 'imported' && selectedImportedPost ? (
          <article className="preview-pane">
            <div className="post-meta">
              <span>wordpress</span>
              <span>source ID {selectedImportedPost.source_id}</span>
              <a href={selectedImportedPost.old_url} target="_blank" rel="noreferrer">Original URL</a>
            </div>
            <h2>{decodeText(selectedImportedPost.title)}</h2>
            {selectedImportedPost.excerpt_text && <p className="summary">{decodeText(selectedImportedPost.excerpt_text)}</p>}
            <div className="term-display">
              <div>
                <strong>Categories</strong>
                <div className="chip-row">
                  {importedTermNames(selectedImportedPost.categories || [], importedCategories).map((name) => <span key={name}>{name}</span>)}
                </div>
              </div>
              <div>
                <strong>Tags</strong>
                <div className="chip-row">
                  {importedTermNames(selectedImportedPost.tags || [], importedTags).map((name) => <span key={name}>{name}</span>)}
                </div>
              </div>
            </div>
            <div className="import-summary">
              <div><strong>{selectedImportedPost.attachments?.length || 0}</strong><span>attachments</span></div>
              <div><strong>{selectedImportedPost.import?.importer_version || '0.1.0'}</strong><span>importer</span></div>
              <div><strong>{selectedImportedIndex && dataset.posts.some((item) => item.id === `wp-${selectedImportedIndex.source_id}`) ? 'yes' : 'no'}</strong><span>adopted</span></div>
            </div>
            {(selectedImportedPost.attachments || []).length > 0 && (
              <section className="attachments-panel">
                <div className="panel-title"><Paperclip size={18} /><h3>Imported Attachments</h3><span>{selectedImportedPost.attachments?.length || 0}</span></div>
                <div className="imported-attachment-list">
                  {importedAttachmentSummary(selectedImportedPost, importOwnerName || ownerTarget).map(({ attachment, mediaItem, qdn }) => (
                    <div key={attachment.source_url || attachment.title} className="imported-attachment-row">
                      <div>
                        <strong>{attachment.title || mediaItem?.title || mediaItem?.local_path?.split('/').pop() || 'Imported media'}</strong>
                        <span>{mediaItem?.type || attachment.media_type || 'file'} · {mediaItem?.local_path || attachment.source_url}</span>
                      </div>
                      {qdn ? (
                        <a className="icon-command" href={qdnLink(qdn)} target="_blank" rel="noreferrer"><Link size={15} /> Open QDN</a>
                      ) : (
                        <span className="muted">not published</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="content-preview" dangerouslySetInnerHTML={{ __html: selectedImportedPost.content_html }} />
            {canManageContent && (
              <div className="action-row">
                <button className="icon-command primary" type="button" onClick={adoptImportedPost}><Plus size={16} /> Adopt into CMS draft</button>
              </div>
            )}
          </article>
        ) : selectedPost && draft ? (
          <>
            <div className="editor-tabs">
              <button className={editorMode === 'preview' ? 'active' : ''} onClick={() => setEditorMode('preview')}><Eye size={16} /> Preview</button>
              {canManageContent && <button className={editorMode === 'edit' ? 'active' : ''} onClick={() => setEditorMode('edit')}><Edit3 size={16} /> Edit</button>}
            </div>

            {editorMode === 'preview' && (
              <article className="preview-pane">
                <div className="post-meta"><span>{selectedPost.status}</span><span>{new Date(selectedPost.updated_at).toLocaleString()}</span>{selectedPost.qdn.name && <a href={qdnLink(selectedPost.qdn)} target="_blank" rel="noreferrer">QDN resource</a>}</div>
                <h2>{decodeText(selectedPost.title)}</h2>
                {selectedPost.excerpt && <p className="summary">{decodeText(selectedPost.excerpt)}</p>}
                <div className="term-display">
                  <div>
                    <strong>Categories</strong>
                    <div className="chip-row">
                      {selectedCategoryNames.length ? selectedCategoryNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}
                    </div>
                  </div>
                  <div>
                    <strong>Tags</strong>
                    <div className="chip-row">
                      {selectedTagNames.length ? selectedTagNames.map((name) => <span key={name}>{name}</span>) : <em>None</em>}
                    </div>
                  </div>
                </div>
                <div className="content-preview" dangerouslySetInnerHTML={{ __html: selectedPost.content_html }} />
                <MediaAttachmentViewer items={selectedMediaItems} />
                {(selectedPost.videos || []).length > 0 && (
                  <section className="attachments-panel">
                    <div className="panel-title"><Video size={18} /><h3>Videos</h3><span>{(selectedPost.videos || []).length}</span></div>
                    <div className="video-embed-list">
                      {(selectedPost.videos || []).map((video) => (
                        <LazyVideoEmbed key={video.id} video={video} />
                      ))}
                    </div>
                  </section>
                )}
                <div className="quick-actions post-quick-actions" aria-label="Post quick actions">
                  <button type="button" onClick={() => void likeSelectedPost()} title="Like post"><Heart size={16} /><span>{likeCounts[selectedPost.id] || 0}</span></button>
                  <button type="button" onClick={() => void shareSelectedPost()} title="Share post"><Share2 size={16} /><span>Share</span></button>
                  <button type="button" onClick={() => void copyPostQdnUri()} disabled={!selectedPost.qdn.name} title="Copy QDN URI"><Link size={16} /><span>Copy</span></button>
                  <button type="button" onClick={() => void openTipModal()} title="Send tip"><Coins size={16} /><span>Tip</span></button>
                  <button type="button" onClick={scrollToComments} title="Comments"><MessageSquare size={16} /><span>{commentsForPost.length}</span></button>
                </div>
              </article>
            )}

            {editorMode === 'edit' && canManageContent && (
              <div className="edit-pane">
                <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value, slug: slugify(event.target.value) })} /></label>
                <label>Slug<input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
                <label>Excerpt<textarea value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} /></label>
                <div className="split-fields">
                  <TermInput label="Categories" value={draft.categoryText} onChange={(categoryText) => setDraft({ ...draft, categoryText })} placeholder="News, Research" terms={dataset.categories} />
                  <TermInput label="Tags" value={draft.tagText} onChange={(tagText) => setDraft({ ...draft, tagText })} placeholder="Qortal, Podcast" terms={dataset.tags} />
                </div>
                <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CmsStatus })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
                <label className="check-line"><input type="checkbox" checked={draft.comments_enabled} onChange={(event) => setDraft({ ...draft, comments_enabled: event.target.checked })} /> Comments enabled</label>
                {selectedMediaItems.length > 0 && (
                  <div className="attached-media-box">
                    <strong>Attached media</strong>
                    {selectedMediaItems.map((item) => (
                      <button key={item.id} type="button" onClick={() => removeMediaFromPost(item)}>
                        <Trash2 size={15} /> {item.title}
                      </button>
                    ))}
                  </div>
                )}
                {(selectedPost.videos || []).length > 0 && (
                  <div className="attached-media-box">
                    <strong>Attached videos</strong>
                    {(selectedPost.videos || []).map((video) => (
                      <button key={video.id} type="button" onClick={() => removeVideoEmbedFromPost(video)}>
                        <Trash2 size={15} /> {video.title}
                      </button>
                    ))}
                  </div>
                )}
                <div className="video-link-box">
                  <strong>Add QDN or Q-Tube video</strong>
                  <input value={videoTitleDraft} onChange={(event) => setVideoTitleDraft(event.target.value)} placeholder="Optional video title" />
                  <textarea value={videoLinkDraft} onChange={(event) => setVideoLinkDraft(event.target.value)} placeholder="qortal://VIDEO/name/identifier&#10;qortal://APP/Q-Tube/video/name/identifier&#10;/arbitrary/VIDEO/name/identifier" />
                  <button type="button" className="icon-command" onClick={addVideoEmbedToPost}><Video size={16} /> Add video link</button>
                </div>
                <RichTextEditor value={draft.content_html} onChange={(content_html) => setDraft({ ...draft, content_html })} />
                <div className="action-row">
                  <button className="icon-command" onClick={saveDraftLocal}><Save size={16} /> Save local draft</button>
                  <button className="icon-command" onClick={() => publishPost('draft')}><Save size={16} /> Save QDN draft</button>
                  <button className="icon-command primary" onClick={() => publishPost('published')}><Send size={16} /> Publish</button>
                </div>
              </div>
            )}

            <section id="post-comments" className="comments-panel">
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
          <div className="placeholder"><FileText size={24} /><strong>No post selected</strong><span>{canManageContent ? 'Create a new post or select an existing one.' : 'Select a published post to read.'}</span></div>
        )}

        {tipOpen && selectedPost && (
          <div className="modal-backdrop" role="presentation" onClick={() => !tipSending && setTipOpen(false)}>
            <div className="tip-modal" role="dialog" aria-modal="true" aria-label="Send tip" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title">
                <strong>Send tip</strong>
                <button type="button" disabled={tipSending} onClick={() => setTipOpen(false)}><XCircle size={18} /> Close</button>
              </div>
              <div className="tip-info"><span>Wallet balance</span><strong>{tipBalance === null ? 'Loading...' : `${tipBalance.toFixed(8)} QORT`}</strong></div>
              <div className="tip-info"><span>Recipient</span><strong>{selectedPost.author.name || 'Unknown author'}</strong><small>{tipRecipient || 'Wallet address unavailable'}</small></div>
              <label className="tip-amount">Amount<input type="number" min="0" step="0.00000001" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} placeholder="0.00000000" /></label>
              {tipError && <p className="preview-error">{tipError}</p>}
              <button type="button" className="icon-command primary" disabled={tipSending} onClick={() => void sendTip()}><Coins size={16} /> {tipSending ? 'Sending...' : 'Send tip'}</button>
            </div>
          </div>
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

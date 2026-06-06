import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { CheckCircle2, Coins, Copy, Download, Edit3, Eye, FileText, Filter, Heart, Image, Link, Paperclip, Play, Plus, RefreshCcw, Save, Search, Send, Settings, Share2, Tags, Trash2, Upload, User, Video, XCircle } from 'lucide-react';
import { internalRouteForWeb2Url } from '../app/routes';
import { RichTextEditor } from './RichTextEditor';
import {
  CMS_VERSION,
  MANIFEST_IDENTIFIER,
  POSTS_INDEX_IDENTIFIER,
  createEmptyManifest,
  createMediaItem,
  createOperatorIdentifier,
  createPostIdentifier,
  createSiteId,
  getQdnNameFromLocation,
  getViewerIdentity,
  loadLocalDataset,
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
  sortPostsNewestFirst,
  toPostIndexItem
} from './cmsRepository';
import { cmsProfile, editorialAuthorName } from './cmsProfile';
import { fetchQdnResource, getQdnResourceStatus, getQdnResourceUrl, getQortalBridgeDiagnostics, hasQortalBridge, requestQortal, toBase64, tryRequestQortal } from './qortalClient';
import { parseVideoLink } from './videoLinks';
import type { CmsDataset, CmsMediaItem, CmsPost, CmsPostIndexItem, CmsStatus, CmsTerm, CmsVideoEmbed, QdnRef, ViewerIdentity } from './types';
import './styles.css';

type Section = 'dashboard' | 'posts' | 'media' | 'imported' | 'settings';
type EditorMode = 'preview' | 'edit';
const IMPORT_BATCH_LIMIT = 10;
const POST_BULK_LIMIT = 10;
const DEFAULT_IMPORT_MANIFEST_IDENTIFIER =
  cmsProfile.importManifestIdentifier;

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
  media?: {
    images?: string[];
    audio?: string[];
    video?: string[];
    documents?: string[];
    embeds?: string[];
  };
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
  profile_id?: string | null;
  canonical_site_name?: string | null;
  qdn_content_name?: string | null;
  qdn_media_name?: string | null;
  public_author?: string;
  publisher_names?: string[];
  coauthor_names?: string[];
  publishers?: Array<{
    name: string;
    generated_at?: string | null;
    summary?: Record<string, number>;
  }>;
  summary?: Record<string, number>;
  entrypoints: Record<string, QdnRef>;
  resources: {
    by_path?: Record<string, QdnRef>;
    by_source_url?: Record<string, QdnRef>;
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

const LINKED_VIDEO_PLATFORM_ICON = /^(archive|bitchute|odysee|rumble|substack|youtube)icon(?:-[a-f0-9]{10})?\.(?:jpe?g|png|webp)$/i;

function mediaFilename(value = '') {
  try {
    const pathname = new URL(value, window.location.origin).pathname;
    return decodeURIComponent(pathname.split('/').pop() || '');
  } catch {
    return value.split(/[?#]/)[0].split('/').pop() || '';
  }
}

function isLinkedVideoPlatformIcon(attachment: ImportedAttachment, mediaItem: ImportedMediaMapItem | null) {
  const filenames = [
    mediaFilename(attachment.source_url || ''),
    mediaFilename(mediaItem?.local_path || '')
  ];
  return filenames.some((filename) => LINKED_VIDEO_PLATFORM_ICON.test(filename));
}

function buildPostPageLink(appName: string, post: Pick<CmsPostIndexItem, 'slug' | 'id'>) {
  const postSlug = post.slug || post.id;
  return `qortal://APP/${encodeURIComponent(appName)}#/posts/${encodeURIComponent(postSlug)}`;
}

function cleanVideoDownloadFilename(value: string) {
  const stem = value
    .replace(/\.mp4$/i, '')
    .replace(/^[a-z0-9-]+-media-/i, '')
    .replace(/(?:-[a-f0-9]{8,})+$/i, '')
    .replace(/^ep(?=\d)/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'video'}.mp4`;
}

function videoDownloadFilename(value: string, fallback = 'video.mp4') {
  try {
    const filename = new URL(value, window.location.origin).pathname.split('/').pop();
    const decodedFilename = filename ? decodeURIComponent(filename) : '';
    return cleanVideoDownloadFilename(/\.mp4$/i.test(decodedFilename) ? decodedFilename : fallback);
  } catch {
    return cleanVideoDownloadFilename(fallback);
  }
}

function isMp4DownloadLink(link: HTMLAnchorElement) {
  return /download\s+the\s+mp4/i.test(link.textContent || '') || /\.mp4(?:[?#]|$)/i.test(link.getAttribute('href') || '');
}

function markQdnVideoDownload(link: HTMLAnchorElement, qdn: QdnRef, filename: string) {
  const qdnUrl = qdnLink(qdn);
  if (!qdnUrl || !qdn.name) return;

  link.setAttribute('href', qdnUrl);
  link.setAttribute('download', filename);
  link.removeAttribute('target');
  link.setAttribute('rel', 'noreferrer');
  link.setAttribute('data-qdn-video-download', 'true');
  link.setAttribute('data-qdn-service', qdn.service);
  link.setAttribute('data-qdn-name', qdn.name);
  link.setAttribute('data-qdn-identifier', qdn.identifier);
  link.setAttribute('data-qdn-filename', filename);
}

function markWeb2CopyLinks(document: Document) {
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const url = link.getAttribute('href') || '';
    if (url.startsWith('#/')) {
      link.setAttribute('data-qortal-internal-link', 'true');
      link.setAttribute('title', 'Open this page inside The Corbett Report');
      continue;
    }
    const internalRoute = internalRouteForWeb2Url(url);
    if (internalRoute) {
      link.setAttribute('data-web2-href', url);
      link.setAttribute('data-qortal-internal-link', 'true');
      link.setAttribute('href', internalRoute);
      link.setAttribute('title', 'Open this page inside The Corbett Report');
      link.removeAttribute('target');
      continue;
    }
    if (!/^https?:\/\//i.test(url)) continue;
    link.setAttribute('data-copy-web2-url', url);
    link.setAttribute('data-copy-tooltip', 'Click this link to copy it to the clipboard');
    link.setAttribute('title', 'Click this link to copy it to the clipboard');
    link.removeAttribute('target');
  }
}

function removeWeb2VideoFallbackNotice(document: Document) {
  const notice = 'video player not working? use these links to watch it somewhere else!';

  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('p, div'))) {
    if ((element.textContent || '').trim().toLowerCase() !== notice) continue;
    element.remove();
  }
}

function rewriteCmsContentLinks(post: CmsPost) {
  const qdnVideos = (post.videos || []).filter((video) => qdnLink(video.qdn));
  if (!post.content_html) return post.content_html;

  const parser = new DOMParser();
  const document = parser.parseFromString(post.content_html, 'text/html');
  const downloadLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(isMp4DownloadLink);

  if (qdnVideos.length > 0) {
    downloadLinks.forEach((link, index) => {
      const video = qdnVideos[Math.min(index, qdnVideos.length - 1)];
      const filename = videoDownloadFilename(
        link.getAttribute('download') || link.getAttribute('href') || '',
        `${video.qdn.identifier}.mp4`
      );
      markQdnVideoDownload(link, video.qdn, filename);
    });
  }

  removeWeb2VideoFallbackNotice(document);
  markWeb2CopyLinks(document);
  return document.body.innerHTML;
}

function publishedAtForPost(post: CmsPost, status: CmsStatus, updatedAt: string) {
  if (status !== 'published') return post.published_at;
  if (post.id.startsWith('wp-')) return post.created_at || post.published_at || updatedAt;
  return post.published_at || updatedAt;
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

function termNamesFromIds(ids: string[], terms: CmsDataset['categories']) {
  const byId = new Map(terms.map((term) => [term.id, term]));

  return ids.map((id) => {
    let currentId = id;
    const visited = new Set<string>();

    while (!visited.has(currentId)) {
      visited.add(currentId);
      const term = byId.get(currentId);
      if (!term) return currentId;
      if (!byId.has(term.name)) return term.name;
      currentId = term.name;
    }

    return byId.get(currentId)?.name || id;
  });
}

function createDraft(post: CmsPost, categories: CmsDataset['categories'] = [], tags: CmsDataset['tags'] = []): DraftState {
  return {
    title: decodeText(post.title),
    slug: post.slug,
    excerpt: decodeText(post.excerpt),
    content_html: post.content_html,
    status: post.status,
    comments_enabled: post.comments_enabled,
    categoryText: termNamesFromIds(post.category_ids, categories).join(', '),
    tagText: termNamesFromIds(post.tag_ids, tags).join(', ')
  };
}

function emptyPost(ownerName: string, ownerAddress: string, siteId: string, siteName: string): CmsPost {
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
    qdn: { service: 'DOCUMENT', identifier: createPostIdentifier(slug, siteId), name: ownerName },
    content_html: '<p></p>',
    cms_site_id: siteId,
    cms_site_name: siteName,
    featured_image: null,
    media: [],
    videos: [],
    comments_enabled: true,
    author: { name: editorialAuthorName(ownerName || 'local-owner'), address: ownerAddress },
    publisher: { name: ownerName || 'local-owner', address: ownerAddress }
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

function manifestForPublisher(manifest: CmsDataset['manifest'], publisherName: string, canonicalSiteName: string) {
  return {
    ...manifest,
    owner_name: publisherName,
    canonical_site_name: canonicalSiteName,
    entrypoints: Object.fromEntries(
      Object.entries(manifest.entrypoints).map(([key, ref]) => [
        key,
        { ...ref, name: publisherName, identifier: createOperatorIdentifier(ref.identifier, manifest.site_id) }
      ])
    ) as CmsDataset['manifest']['entrypoints']
  };
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
  if (!value.trim()) return false;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    if (document.execCommand('copy')) {
      return true;
    }
  } catch {
    // Continue with the modern Clipboard API when the legacy fallback is blocked.
  } finally {
    document.body.removeChild(textarea);
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // The Clipboard API can be blocked inside a Qortal UI iframe.
  }

  return false;
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

function createFallbackIdentity(ownerName: string): ViewerIdentity {
  return {
    address: '',
    name: '',
    names: [],
    ownerTarget: ownerName,
    role: 'reader',
    bridgeAvailable: hasQortalBridge(),
    identityIssue: hasQortalBridge()
      ? 'Qortal identity was not approved or returned no account data.'
      : 'Qortal request bridge is not available in this browser context.'
  };
}

export function CmsBackendApp() {
  const qdnName = cmsProfile.ownerName || getQdnNameFromLocation();
  const [section, setSection] = useState<Section>('posts');
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [dataset, setDataset] = useState<CmsDataset | null>(null);
  const [identity, setIdentity] = useState<ViewerIdentity | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<CmsPostIndexItem | null>(null);
  const [selectedPost, setSelectedPost] = useState<CmsPost | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CmsStatus | 'all'>('all');
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [bulkPostStatus, setBulkPostStatus] = useState<CmsStatus>('published');
  const [isBulkPostAction, setIsBulkPostAction] = useState(false);
  const [mediaTitleDraft, setMediaTitleDraft] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [videoLinkDraft, setVideoLinkDraft] = useState('');
  const [videoTitleDraft, setVideoTitleDraft] = useState('');
  const [siteTitleDraft, setSiteTitleDraft] = useState('');
  const [siteTaglineDraft, setSiteTaglineDraft] = useState('');
  const [coauthorAddressDraft, setCoauthorAddressDraft] = useState('');
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState('');
  const [tipBalance, setTipBalance] = useState<number | null>(null);
  const [tipRecipient, setTipRecipient] = useState('');
  const [tipError, setTipError] = useState('');
  const [tipSending, setTipSending] = useState(false);
  const [importOwnerName, setImportOwnerName] = useState(cmsProfile.importOwnerName || qdnName);
  const [importManifestIdentifier, setImportManifestIdentifier] = useState(DEFAULT_IMPORT_MANIFEST_IDENTIFIER);
  const [importedManifest, setImportedManifest] = useState<ImportedQdnManifest | null>(null);
  const [importedPosts, setImportedPosts] = useState<ImportedIndexItem[]>([]);
  const [importedCategories, setImportedCategories] = useState<ImportedTerm[]>([]);
  const [importedTags, setImportedTags] = useState<ImportedTerm[]>([]);
  const [importedMediaMap, setImportedMediaMap] = useState<ImportedMediaMap>({});
  const [selectedImportedPost, setSelectedImportedPost] = useState<ImportedPost | null>(null);
  const [selectedImportedIndex, setSelectedImportedIndex] = useState<ImportedIndexItem | null>(null);
  const [selectedImportedIds, setSelectedImportedIds] = useState<number[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<{ message: string; success: boolean } | null>(null);

  useEffect(() => {
    if (!clipboardNotice) return;
    const timeout = window.setTimeout(() => setClipboardNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [clipboardNotice]);

  useEffect(() => {
    boot().catch((bootError: Error) => {
      setError(bootError.message);
      setStatus('');
    });
  }, []);

  async function boot() {
    setStatus('Loading CMS dataset...');
    setError(null);
    let initialIdentity: ViewerIdentity | null = null;
    let loadedDataset: CmsDataset | null = null;

    if (qdnName) {
      loadedDataset = await loadQdnDataset(qdnName);
    } else {
      initialIdentity = await getViewerIdentity('').catch(() => createFallbackIdentity(''));
      const ownerCandidates = initialIdentity.names.map((name) => name.trim()).filter(Boolean);
      const uniqueOwnerCandidates = [...new Set(ownerCandidates.map((name) => normalizePrincipal(name)))];
      const ownerCandidateByNormalized = new Map(ownerCandidates.map((name) => [normalizePrincipal(name), name]));

      for (const normalizedName of uniqueOwnerCandidates) {
        const candidate = ownerCandidateByNormalized.get(normalizedName) || normalizedName;
        loadedDataset = await loadQdnDataset(candidate);
        if (loadedDataset) break;
      }
    }

    loadedDataset ||= loadLocalDataset(qdnName || initialIdentity?.name || '');
    const ownerName = qdnName || loadedDataset.manifest.owner_name || initialIdentity?.name || '';
    setDataset(loadedDataset);
    setIdentity(initialIdentity || createFallbackIdentity(ownerName));
    setSiteTitleDraft(loadedDataset.manifest.title);
    setSiteTaglineDraft(loadedDataset.manifest.tagline || '');
    const initialPost = loadedDataset.posts[0] || null;
    setSelectedIndex(initialPost);
    setStatus('');

    void getViewerIdentity(ownerName, loadedDataset.manifest)
      .then(setIdentity)
      .catch(() => {});

    if (initialPost) {
      void safeLoadPost(initialPost, loadedDataset)
        .then((post) => {
          setSelectedPost(post);
          setDraft(createDraft(post, loadedDataset.categories, loadedDataset.tags));
        })
        .catch((openError: Error) => {
          setError(openError.message);
        });
    }
  }

  useEffect(() => {
    if (!dataset) return;
    setSiteTitleDraft(dataset.manifest.title);
    setSiteTaglineDraft(dataset.manifest.tagline || '');
  }, [dataset?.manifest.site_id]);

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
  const isCoauthor = identity?.role === 'coauthor';
  const canManageContent = identity?.role === 'sysop' || identity?.role === 'coauthor';
  const bridgeDiagnostics = getQortalBridgeDiagnostics();
  const canAdoptImportedContent = Boolean(isSysop || (isCoauthor && cmsProfile.trustedCoauthorsCanAdoptImports));
  const canManageMediaLibrary = Boolean(isSysop || (isCoauthor && cmsProfile.trustedCoauthorsCanPublishMedia));
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
      setDraft(createDraft(post, dataset.categories, dataset.tags));
      setEditorMode('preview');
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      setStatus('');
    }
  }

  function togglePostSelection(postId: string) {
    setSelectedPostIds((current) => {
      if (current.includes(postId)) return current.filter((id) => id !== postId);
      if (current.length >= POST_BULK_LIMIT) {
        setStatus(`Bulk post limit is ${POST_BULK_LIMIT} posts at once.`);
        return current;
      }
      return [...current, postId];
    });
  }

  function selectVisiblePosts() {
    const ids = filteredPosts.slice(0, POST_BULK_LIMIT).map((post) => post.id);
    setSelectedPostIds(ids);
    setStatus(ids.length ? `${ids.length} visible posts selected.` : 'No visible posts to select.');
  }

  async function publishPostCatalog(nextDataset: CmsDataset, publishName: string, cmsSiteName: string) {
    const publishedManifest = isSysop
      ? nextDataset.manifest
      : manifestForPublisher(nextDataset.manifest, publishName, cmsSiteName);
    const publishedManifestIdentifier = isSysop
      ? MANIFEST_IDENTIFIER
      : createOperatorIdentifier(MANIFEST_IDENTIFIER, nextDataset.manifest.site_id);

    await publishJsonResources(publishName, [
      { ref: publishedManifest.entrypoints.posts_index, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
      { ref: publishedManifest.entrypoints.pages_index, data: nextDataset.pages, title: 'CMS pages index', description: 'Qortal CMS pages index' },
      { ref: publishedManifest.entrypoints.categories, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
      { ref: publishedManifest.entrypoints.tags, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
      { ref: publishedManifest.entrypoints.media_index, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
      { ref: publishedManifest.entrypoints.comments_index, data: nextDataset.comments, title: 'CMS comments index', description: 'Qortal CMS comments index' },
      { ref: { service: 'DOCUMENT', identifier: publishedManifestIdentifier, name: publishName }, data: publishedManifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
    ]);
  }

  async function applyBulkPostStatus() {
    if (!dataset || !identity || !canManageContent || selectedPostIds.length === 0) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI to update posts.');
      return;
    }

    const selectedIndexes = dataset.posts.filter((post) => selectedPostIds.includes(post.id));
    const cmsSiteName = dataset.manifest.owner_name || qdnName || identity.name;
    const publishName = isSysop ? cmsSiteName : identity.name;
    if (!cmsSiteName || !publishName) {
      setError('Missing Qortal name. Updating posts requires a logged-in Qortal account with a registered name.');
      return;
    }

    setError(null);
    setIsBulkPostAction(true);
    try {
      setStatus(`Loading ${selectedIndexes.length} selected posts...`);
      const loadedPosts = await Promise.all(selectedIndexes.map((index) => safeLoadPost(index, dataset)));
      const updatedAt = new Date().toISOString();
      const updatedPosts = loadedPosts.map((post) => ({
        ...post,
        status: bulkPostStatus,
        updated_at: updatedAt,
        published_at: publishedAtForPost(post, bulkPostStatus, updatedAt),
        cms_site_id: dataset.manifest.site_id,
        cms_site_name: cmsSiteName,
        qdn: {
          ...post.qdn,
          service: 'DOCUMENT',
          name: publishName,
          identifier: isSysop ? post.qdn.identifier : createPostIdentifier(post.slug, dataset.manifest.site_id)
        },
        publisher: { name: publishName, address: identity.address }
      } satisfies CmsPost));
      const updatedById = new Map(updatedPosts.map((post) => [post.id, post]));
      const nextPosts = sortPostsNewestFirst(dataset.posts.map((index) => {
        const updated = updatedById.get(index.id);
        return updated ? toPostIndexItem(updated) : index;
      }));
      const nextDataset: CmsDataset = {
        ...dataset,
        manifest: {
          ...dataset.manifest,
          updated_at: updatedAt,
          owner_name: cmsSiteName,
          owner_address: dataset.manifest.owner_address || identity.address
        },
        posts: nextPosts,
        local_posts: {
          ...(dataset.local_posts || {}),
          ...Object.fromEntries(updatedPosts.map((post) => [post.id, post]))
        }
      };
      const publishedManifest = isSysop
        ? nextDataset.manifest
        : manifestForPublisher(nextDataset.manifest, publishName, cmsSiteName);
      const publishedManifestIdentifier = isSysop
        ? MANIFEST_IDENTIFIER
        : createOperatorIdentifier(MANIFEST_IDENTIFIER, dataset.manifest.site_id);

      setStatus(`Applying ${bulkPostStatus} status to ${updatedPosts.length} posts...`);
      await publishJsonResources(publishName, [
        ...updatedPosts.map((post) => ({
          ref: post.qdn,
          data: post,
          title: post.title,
          description: stripHtml(post.excerpt || post.content_html).slice(0, 4000)
        })),
        { ref: publishedManifest.entrypoints.posts_index, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: { service: 'DOCUMENT', identifier: publishedManifestIdentifier, name: publishName }, data: publishedManifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ]);

      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      const refreshedSelected = selectedPost ? updatedById.get(selectedPost.id) : null;
      if (refreshedSelected) {
        setSelectedPost(refreshedSelected);
        setSelectedIndex(toPostIndexItem(refreshedSelected));
        setDraft(createDraft(refreshedSelected, nextDataset.categories, nextDataset.tags));
      }
      setSelectedPostIds([]);
      setStatus(`${updatedPosts.length} posts changed to ${bulkPostStatus}.`);
    } catch (bulkError) {
      setError(readableError(bulkError, 'Bulk post status update failed.'));
      setStatus('');
    } finally {
      setIsBulkPostAction(false);
    }
  }

  async function deleteSelectedPosts() {
    if (!dataset || !identity || !canManageContent || selectedPostIds.length === 0) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI to remove posts.');
      return;
    }
    const confirmed = window.confirm(
      `Remove ${selectedPostIds.length} selected post(s) from the CMS catalog? ` +
      'Previously published QDN versions remain in QDN history.'
    );
    if (!confirmed) return;

    const cmsSiteName = dataset.manifest.owner_name || qdnName || identity.name;
    const publishName = isSysop ? cmsSiteName : identity.name;
    if (!cmsSiteName || !publishName) {
      setError('Missing Qortal name. Removing posts requires a logged-in Qortal account with a registered name.');
      return;
    }

    const selectedSet = new Set(selectedPostIds);
    const updatedAt = new Date().toISOString();
    const nextLocalPosts = { ...(dataset.local_posts || {}) };
    selectedPostIds.forEach((id) => delete nextLocalPosts[id]);
    const nextDataset: CmsDataset = {
      ...dataset,
      manifest: {
        ...dataset.manifest,
        updated_at: updatedAt,
        owner_name: cmsSiteName,
        owner_address: dataset.manifest.owner_address || identity.address
      },
      posts: dataset.posts.filter((post) => !selectedSet.has(post.id)),
      local_posts: nextLocalPosts
    };

    setError(null);
    setIsBulkPostAction(true);
    try {
      setStatus(`Removing ${selectedSet.size} posts from the CMS catalog...`);
      await publishPostCatalog(nextDataset, publishName, cmsSiteName);
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      if (selectedPost && selectedSet.has(selectedPost.id)) {
        const nextIndex = nextDataset.posts[0] || null;
        setSelectedIndex(nextIndex);
        if (nextIndex) {
          const nextPost = await safeLoadPost(nextIndex, nextDataset);
          setSelectedPost(nextPost);
          setDraft(createDraft(nextPost, nextDataset.categories, nextDataset.tags));
        } else {
          setSelectedPost(null);
          setDraft(null);
        }
      }
      setSelectedPostIds([]);
      setStatus(`${selectedSet.size} posts removed from the CMS catalog.`);
    } catch (deleteError) {
      setError(readableError(deleteError, 'Removing posts from the CMS catalog failed.'));
      setStatus('');
    } finally {
      setIsBulkPostAction(false);
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
    const post = emptyPost(identity.name || cmsSiteName, identity.address, dataset.manifest.site_id, cmsSiteName);
    setSelectedIndex(toPostIndexItem(post));
    setSelectedPost(post);
    setDraft(createDraft(post, dataset.categories, dataset.tags));
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
      cms_site_id: dataset.manifest.site_id,
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
      published_at: publishedAtForPost(selectedPost, statusOverride || draft.status, updatedAt),
      qdn: {
        ...selectedPost.qdn,
        name: selectedPost.qdn.name || identity.name || cmsSiteName,
        identifier: selectedPost.qdn.identifier || createPostIdentifier(slug, dataset.manifest.site_id)
      },
      author: selectedPost.author.name && selectedPost.id !== 'sample-post'
        ? selectedPost.author
        : { name: editorialAuthorName(identity.name), address: identity.address },
      publisher: selectedPost.publisher || { name: identity.name, address: identity.address }
    };
    const index = toPostIndexItem(post);
    const exists = dataset.posts.some((item) => item.id === index.id);
    const posts = sortPostsNewestFirst(exists
      ? dataset.posts.map((item) => item.id === index.id ? index : item)
      : [index, ...dataset.posts]);
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
      cms_site_id: dataset.manifest.site_id,
      cms_site_name: cmsSiteName,
      qdn: {
        ...applied.post.qdn,
        service: 'DOCUMENT',
        name: publishName,
        identifier: isSysop
          ? applied.post.qdn.identifier
          : createPostIdentifier(applied.post.slug, dataset.manifest.site_id)
      },
      publisher: { name: publishName, address: identity.address }
    };
    const postIndex = toPostIndexItem(postToPublish);
    const posts = sortPostsNewestFirst(applied.nextDataset.posts.some((item) => item.id === postIndex.id)
      ? applied.nextDataset.posts.map((item) => item.id === postIndex.id ? postIndex : item)
      : [postIndex, ...applied.nextDataset.posts]);
    const nextDataset: CmsDataset = {
      ...applied.nextDataset,
      manifest: { ...applied.nextDataset.manifest, owner_name: cmsSiteName, owner_address: applied.nextDataset.manifest.owner_address || identity.address },
      posts,
      local_posts: { ...(applied.nextDataset.local_posts || {}), [postToPublish.id]: postToPublish }
    };
    const publishedManifest = isSysop
      ? nextDataset.manifest
      : manifestForPublisher(nextDataset.manifest, publishName, cmsSiteName);
    const publishedManifestIdentifier = isSysop
      ? MANIFEST_IDENTIFIER
      : createOperatorIdentifier(MANIFEST_IDENTIFIER, dataset.manifest.site_id);

    setError(null);
    try {
      setStatus(`${postToPublish.status === 'published' ? 'Publishing post' : 'Saving QDN draft'} and updating ${isSysop ? 'canonical' : 'operator'} indexes...`);
      const publishItems: Parameters<typeof publishJsonResources>[1] = [
        {
          ref: postToPublish.qdn,
          data: postToPublish,
          title: postToPublish.title,
          description: stripHtml(postToPublish.excerpt || postToPublish.content_html).slice(0, 4000)
        },
        { ref: publishedManifest.entrypoints.posts_index, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: publishedManifest.entrypoints.pages_index, data: nextDataset.pages, title: 'CMS pages index', description: 'Qortal CMS pages index' },
        { ref: publishedManifest.entrypoints.categories, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
        { ref: publishedManifest.entrypoints.tags, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
        { ref: publishedManifest.entrypoints.media_index, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
        { ref: publishedManifest.entrypoints.comments_index, data: nextDataset.comments, title: 'CMS comments index', description: 'Qortal CMS comments index' },
        { ref: { service: 'DOCUMENT', identifier: publishedManifestIdentifier, name: publishName }, data: publishedManifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ];

      await publishJsonResources(publishName, publishItems);

      setDataset(nextDataset);
      setSelectedPost(postToPublish);
      setSelectedIndex(postIndex);
      saveLocalDataset(nextDataset);
      setDraft(createDraft(postToPublish, nextDataset.categories, nextDataset.tags));
      setStatus(postToPublish.status === 'published'
        ? `Published directly under ${publishName}.`
        : `Draft saved directly under ${publishName}.`);
    } catch (publishError) {
      setError(readableError(publishError, 'Qortal publish failed. Check that the logged-in account owns the publish target name.'));
      setStatus('');
    }
  }

  function initLocalSite() {
    const ownerName = qdnName || identity?.name || 'local-owner';
    const ownerAddress = identity?.address || '';
    const manifest = createEmptyManifest(ownerName, ownerAddress);
    const nextDataset = {
      manifest,
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
    setSiteTitleDraft(manifest.title);
    setSiteTaglineDraft(manifest.tagline || '');
    setStatus('Local CMS dataset initialized.');
  }

  async function publishManifestUpdate(nextDataset: CmsDataset) {
    const ownerName = qdnName || nextDataset.manifest.owner_name || identity?.name || '';
    if (!ownerName) throw new Error('Missing owner Qortal name.');
    if (!hasQortalBridge()) throw new Error('Qortal bridge is not available. Open through Qortal UI dev mode.');

    await publishJsonResource(ownerName, { service: 'DOCUMENT', identifier: MANIFEST_IDENTIFIER, name: ownerName }, nextDataset.manifest, 'CMS manifest', 'Qortal CMS manifest');
  }

  async function saveSiteIdentity() {
    if (!dataset || !identity || !isSysop) return;
    const title = siteTitleDraft.trim() || dataset.manifest.title || 'Qortal CMS';
    const tagline = siteTaglineDraft.trim();
    const nextManifest = {
      ...dataset.manifest,
      site_id: dataset.manifest.site_id || createSiteId(dataset.manifest.owner_name || title),
      title,
      tagline,
      owner_address: dataset.manifest.owner_address || identity.address,
      updated_at: new Date().toISOString()
    };
    const nextDataset = { ...dataset, manifest: nextManifest };

    setError(null);
    try {
      setStatus('Publishing site identity...');
      await publishManifestUpdate(nextDataset);
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setStatus('Site identity saved.');
    } catch (siteError) {
      setError((siteError as Error).message);
      setStatus('');
    }
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
    const identifier = importManifestIdentifier.trim() || DEFAULT_IMPORT_MANIFEST_IDENTIFIER;
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
      const unadoptedCount = posts.filter(
        (post) => !dataset?.posts.some((item) => item.id === `wp-${post.source_id}`)
      ).length;
      setStatus(
        `${manifest.publishers?.length ? 'Merged catalog' : 'Publisher manifest'} loaded: ` +
        `${posts.length} posts, ${Object.keys(mediaMap).length} media entries, ${unadoptedCount} not adopted.`
      );
    } catch (importError) {
      setError((importError as Error).message);
      setStatus('');
    }
  }

  function applyProfileCatalogPreset() {
    setImportOwnerName(cmsProfile.importOwnerName || qdnName);
    setImportManifestIdentifier(cmsProfile.importManifestIdentifier);
    setStatus(`Applied ${cmsProfile.id} catalog preset.`);
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

  function importedMediaRef(mediaItem: ImportedMediaMapItem, ownerName: string, sourceUrl = ''): QdnRef | null {
    const sourceRef = sourceUrl ? importedManifest?.resources.by_source_url?.[sourceUrl] : null;
    if (sourceRef) return withQdnName(sourceRef, ownerName);
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
    const attachments: ImportedAttachment[] = [...(post.attachments || [])];
    const knownUrls = new Set(attachments.map((attachment) => attachment.source_url).filter(Boolean));
    const extractedMedia = [
      ...((post.media?.images || []).map((source_url) => ({ source_url, media_type: 'image' }))),
      ...((post.media?.audio || []).map((source_url) => ({ source_url, media_type: 'audio' }))),
      ...((post.media?.video || []).map((source_url) => ({ source_url, media_type: 'video' }))),
      ...((post.media?.documents || []).map((source_url) => ({ source_url, media_type: 'document' })))
    ];

    for (const attachment of extractedMedia) {
      if (!knownUrls.has(attachment.source_url)) {
        attachments.push(attachment);
        knownUrls.add(attachment.source_url);
      }
    }

    return attachments.map((attachment) => {
      const mediaItem = attachmentMediaItem(attachment);
      const qdn = mediaItem ? importedMediaRef(mediaItem, ownerName, attachment.source_url) : null;
      return { attachment, mediaItem, qdn };
    }).filter(({ attachment, mediaItem }) => !isLinkedVideoPlatformIcon(attachment, mediaItem));
  }

  function rewriteImportedHtml(post: ImportedPost, ownerName: string) {
    const parser = new DOMParser();
    const document = parser.parseFromString(post.content_html || '', 'text/html');

    function resolveImportedQdnRef(value: string | null) {
      if (!value) return '';
      const mediaItem = importedMediaMap[value];
      return mediaItem ? importedMediaRef(mediaItem, ownerName, value) : null;
    }

    function resolveImportedQdnUrl(value: string | null) {
      const qdn = resolveImportedQdnRef(value);
      return qdn ? qdnLink(qdn) : '';
    }

    function resolveImportedUrl(value: string | null) {
      if (!value) return '';
      return resolveImportedQdnUrl(value) || value;
    }

    for (const image of Array.from(document.querySelectorAll('img'))) {
      image.setAttribute('src', resolveImportedUrl(image.getAttribute('src') || image.getAttribute('data-lazy-src')));
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.removeAttribute('data-lazy-src');
      image.setAttribute('loading', 'lazy');
    }

    for (const source of Array.from(document.querySelectorAll('source[srcset]'))) {
      source.removeAttribute('srcset');
    }

    for (const media of Array.from(document.querySelectorAll('audio[src], video[src], source[src]'))) {
      media.setAttribute('src', resolveImportedUrl(media.getAttribute('src')));
    }

    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const originalUrl = link.getAttribute('href');
      const qdn = resolveImportedQdnRef(originalUrl);
      const qdnUrl = qdn ? qdnLink(qdn) : '';
      link.setAttribute('href', qdnUrl || originalUrl || '');
      if (qdn && isMp4DownloadLink(link)) {
        markQdnVideoDownload(link, qdn, videoDownloadFilename(originalUrl || '', `${qdn.identifier}.mp4`));
      }
    }

    const inlineVideoUrls = (post.media?.video || [])
      .map((sourceUrl) => resolveImportedQdnUrl(sourceUrl))
      .filter((sourceUrl) => sourceUrl !== '');
    const frames = Array.from(document.querySelectorAll('iframe'));
    for (let index = 0; index < frames.length && index < inlineVideoUrls.length; index += 1) {
      const video = document.createElement('video');
      video.setAttribute('controls', '');
      video.setAttribute('preload', 'none');
      video.setAttribute('playsinline', '');
      video.setAttribute('src', inlineVideoUrls[index]);
      video.setAttribute('class', 'qdn-inline-video');
      const wrapper = frames[index].parentElement;
      if (wrapper?.children.length === 1) wrapper.replaceWith(video);
      else frames[index].replaceWith(video);
    }

    removeWeb2VideoFallbackNotice(document);
    markWeb2CopyLinks(document);
    return document.body.innerHTML;
  }

  function standaloneVideosForPost(post: CmsPost) {
    return (post.videos || []).filter((video) => !post.content_html.includes(qdnLink(video.qdn)));
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
    siteId: string,
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
      cms_site_id: siteId,
      cms_site_name: ownerName,
      created_at: importedPost.date || now,
      updated_at: now,
      published_at: importedPost.date || null,
      qdn: existing?.qdn || { service: 'DOCUMENT', identifier: createPostIdentifier(slug, siteId), name: ownerName },
      content_html: `${rewriteImportedHtml(importedPost, ownerName)}<hr/><p><small>Imported from WordPress source ID ${importedPost.source_id}. Original URL: <a href="${importedPost.old_url}" target="_blank" rel="noreferrer">${importedPost.old_url}</a></small></p>`,
      featured_image: mediaItems.find((item) => item.type === 'image')?.qdn || null,
      media: attachedMedia,
      videos,
      comments_enabled: true,
      author: { name: editorialAuthorName(importedManifest?.public_author || author.name || ownerName), address: author.address },
      publisher: { name: ownerName, address: author.address }
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
    if (!dataset || !identity || !canAdoptImportedContent || !selectedImportedPost) return;
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    const publishName = isSysop ? ownerName : identity.name;
    if (!ownerName || !publishName) {
      setError('Missing owner Qortal name.');
      return;
    }

    const existing = dataset.posts.find((post) => post.id === `wp-${selectedImportedPost.source_id}`);
    const now = new Date().toISOString();
    const built = buildCmsPostFromImported(selectedImportedPost, dataset.categories, dataset.tags, ownerName, dataset.manifest.site_id, identity, now, existing);
    const post = isSysop ? built.post : {
      ...built.post,
      qdn: { ...built.post.qdn, name: publishName },
      publisher: { name: publishName, address: identity.address }
    };
    const index = toPostIndexItem(post);
    const posts = sortPostsNewestFirst(existing
      ? dataset.posts.map((item) => item.id === index.id ? index : item)
      : [index, ...dataset.posts]);
    const nextDataset: CmsDataset = {
      ...dataset,
      manifest: { ...dataset.manifest, updated_at: now, owner_name: ownerName, owner_address: dataset.manifest.owner_address || identity.address },
      posts,
      categories: built.categories,
      tags: built.tags,
      media: mergeMediaItems(dataset.media, built.mediaItems),
      local_posts: { ...(dataset.local_posts || {}), [post.id]: post }
    };
    const publishedManifest = isSysop
      ? nextDataset.manifest
      : manifestForPublisher(nextDataset.manifest, publishName, ownerName);
    const publishedManifestIdentifier = isSysop
      ? MANIFEST_IDENTIFIER
      : createOperatorIdentifier(MANIFEST_IDENTIFIER, dataset.manifest.site_id);

    setError(null);
    try {
      setStatus('Adopting imported post as CMS draft...');
      await publishJsonResources(publishName, [
        { ref: post.qdn, data: post, title: post.title, description: stripHtml(post.excerpt || post.content_html).slice(0, 4000) },
        { ref: publishedManifest.entrypoints.posts_index, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: publishedManifest.entrypoints.categories, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
        { ref: publishedManifest.entrypoints.tags, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
        { ref: publishedManifest.entrypoints.media_index, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
        { ref: { service: 'DOCUMENT', identifier: publishedManifestIdentifier }, data: publishedManifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ]);
      setDataset(nextDataset);
      setSelectedPost(post);
      setSelectedIndex(index);
      setDraft(createDraft(post, nextDataset.categories, nextDataset.tags));
      setEditorMode('preview');
      saveLocalDataset(nextDataset);
      setStatus(isSysop ? 'Imported post adopted as CMS draft.' : `Imported post adopted under trusted operator ${publishName}.`);
    } catch (adoptError) {
      setError((adoptError as Error).message);
      setStatus('');
    }
  }

  async function adoptSelectedImportedPosts() {
    if (!dataset || !identity || !canAdoptImportedContent || selectedImportedIds.length === 0) return;
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    const publishName = isSysop ? ownerName : identity.name;
    if (!ownerName || !publishName) {
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
        const imported = buildCmsPostFromImported(importedPost, categories, tags, ownerName, dataset.manifest.site_id, identity, now);
        const built = isSysop ? imported.post : {
          ...imported.post,
          qdn: { ...imported.post.qdn, name: publishName },
          publisher: { name: publishName, address: identity.address }
        };
        importedIndexes.push(toPostIndexItem(built));
        categories = imported.categories;
        tags = imported.tags;
        media = mergeMediaItems(media, imported.mediaItems);
        localPosts[built.id] = built;
        if (!firstPost) firstPost = built;
        publishItems.push({
          ref: built.qdn,
          data: built,
          title: built.title,
          description: stripHtml(built.excerpt || built.content_html).slice(0, 4000)
        });
      }

      const nextDataset: CmsDataset = {
        ...dataset,
        manifest: { ...dataset.manifest, updated_at: now, owner_name: ownerName, owner_address: dataset.manifest.owner_address || identity.address },
        posts: sortPostsNewestFirst([...importedIndexes, ...dataset.posts]),
        categories,
        tags,
        media,
        local_posts: localPosts
      };
      const publishedManifest = isSysop
        ? nextDataset.manifest
        : manifestForPublisher(nextDataset.manifest, publishName, ownerName);
      const publishedManifestIdentifier = isSysop
        ? MANIFEST_IDENTIFIER
        : createOperatorIdentifier(MANIFEST_IDENTIFIER, dataset.manifest.site_id);

      setStatus(`Publishing ${selectedIndexes.length} imported CMS drafts...`);
      await publishJsonResources(publishName, [
        ...publishItems,
        { ref: publishedManifest.entrypoints.posts_index, data: nextDataset.posts, title: 'CMS posts index', description: 'Qortal CMS posts index' },
        { ref: publishedManifest.entrypoints.categories, data: nextDataset.categories, title: 'CMS categories', description: 'Qortal CMS categories' },
        { ref: publishedManifest.entrypoints.tags, data: nextDataset.tags, title: 'CMS tags', description: 'Qortal CMS tags' },
        { ref: publishedManifest.entrypoints.media_index, data: nextDataset.media, title: 'CMS media index', description: 'Qortal CMS media index' },
        { ref: { service: 'DOCUMENT', identifier: publishedManifestIdentifier }, data: publishedManifest, title: 'CMS manifest', description: 'Qortal CMS manifest' }
      ]);

      setDataset(nextDataset);
      if (firstPost) {
        setSelectedPost(firstPost);
        setSelectedIndex(toPostIndexItem(firstPost));
        setDraft(createDraft(firstPost, nextDataset.categories, nextDataset.tags));
        setEditorMode('preview');
      }
      setSelectedImportedIds([]);
      saveLocalDataset(nextDataset);
      setStatus(isSysop
        ? `${selectedIndexes.length} imported posts adopted as CMS drafts.`
        : `${selectedIndexes.length} imported posts adopted under trusted operator ${publishName}.`);
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

  async function copyPostQdnUri() {
    if (!selectedPost) return;
    const copied = await copyText(toQortalUri(selectedPost.qdn));
    setStatus(copied ? 'Post QDN URI copied.' : 'Unable to copy QDN URI.');
  }

  async function handleContentLinkClick(event: MouseEvent<HTMLElement>) {
    const qdnVideoLink = (event.target as Element).closest<HTMLAnchorElement>('a[data-qdn-video-download]');
    if (qdnVideoLink) {
      event.preventDefault();
      event.stopPropagation();
      const service = qdnVideoLink.dataset.qdnService || '';
      const name = qdnVideoLink.dataset.qdnName || '';
      const identifier = qdnVideoLink.dataset.qdnIdentifier || '';
      const filename = qdnVideoLink.dataset.qdnFilename || `${identifier}.mp4`;
      if (!service || !name || !identifier) {
        setStatus('Video download link is incomplete.');
        return;
      }

      try {
        setStatus('Preparing QDN video download...');
        const url = await getQdnResourceUrl(service, name, identifier);
        downloadResource(url, filename);
        setStatus('Video download started.');
      } catch (downloadError) {
        setError((downloadError as Error).message || 'Unable to download QDN video.');
        setStatus('');
      }
      return;
    }

    const internalLink = (event.target as Element).closest<HTMLAnchorElement>('a[data-qortal-internal-link]');
    if (internalLink) {
      const route = internalLink.getAttribute('href') || '';
      if (route.startsWith('#/')) {
        event.preventDefault();
        event.stopPropagation();
        window.location.hash = route.slice(1);
      }
      return;
    }

    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-copy-web2-url]');
    const url = link?.dataset.copyWeb2Url;
    if (!url) return;

    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(url);
    setClipboardNotice({
      success: copied,
      message: copied ? 'Link copied successfully to clipboard' : 'Unable to copy link to clipboard'
    });
    setStatus(copied ? 'Web2 link copied.' : 'Unable to copy Web2 link.');
  }

  function postShareUrl() {
    if (!selectedPost || !dataset) return '';
    const appName = qdnName || dataset.manifest.owner_name;
    return appName ? buildPostPageLink(appName, selectedPost) : '';
  }

  async function shareSelectedPost() {
    if (!selectedPost) return;
    const url = postShareUrl();
    if (!url) {
      setStatus('Post link is unavailable.');
      return;
    }
    const copied = await copyText(url);
    setStatus(copied ? 'Post link copied.' : 'Unable to copy post link.');
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

  async function publishMediaFile() {
    if (!dataset || !identity || !canManageMediaLibrary || !mediaFile) return;
    if (!hasQortalBridge()) {
      setError('Qortal bridge is not available. Open this CMS through Qortal UI dev mode to publish media.');
      return;
    }
    const ownerName = qdnName || dataset.manifest.owner_name || identity.name;
    const publishName = isSysop ? ownerName : identity.name;
    if (!ownerName || !publishName) {
      setError('Missing owner Qortal name. Open with ?name=<QortalName>.');
      return;
    }

    const mediaItem = createMediaItem(mediaFile, publishName, identity.address);
    mediaItem.title = mediaTitleDraft.trim() || mediaItem.title;
    const updatedManifest = {
      ...dataset.manifest,
      updated_at: new Date().toISOString(),
      owner_name: ownerName,
      owner_address: dataset.manifest.owner_address || identity.address
    };
    const publishedManifest = isSysop
      ? updatedManifest
      : manifestForPublisher(updatedManifest, publishName, ownerName);
    const publishedManifestIdentifier = isSysop
      ? MANIFEST_IDENTIFIER
      : createOperatorIdentifier(MANIFEST_IDENTIFIER, dataset.manifest.site_id);
    const nextMedia = [mediaItem, ...dataset.media];

    setError(null);
    try {
      setStatus('Publishing media and updating media index...');
      await publishMediaWithIndex(publishName, mediaFile, mediaItem, nextMedia, publishedManifest, publishedManifestIdentifier);
      const nextDataset = { ...dataset, manifest: updatedManifest, media: nextMedia };
      setDataset(nextDataset);
      saveLocalDataset(nextDataset);
      setMediaFile(null);
      setMediaTitleDraft('');
      setStatus(isSysop ? 'Media published to QDN.' : `Media published under trusted operator ${publishName}.`);
    } catch (mediaError) {
      setError(readableError(mediaError, 'Qortal media publish failed. Check that the logged-in account owns the publish target name.'));
      setStatus('');
    }
  }

  function attachMediaToPost(mediaItem: CmsMediaItem) {
    if (!selectedPost || !dataset) return;
    const exists = selectedPost.media.some((ref) => sameQdnRef(ref, mediaItem.qdn));
    if (exists) return;
    const nextPost = { ...selectedPost, media: [...selectedPost.media, mediaItem.qdn] };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost, dataset.categories, dataset.tags));
    setStatus('Media attached to current post. Save draft or publish to persist.');
  }

  function removeMediaFromPost(mediaItem: CmsMediaItem) {
    if (!selectedPost || !dataset) return;
    const nextPost = { ...selectedPost, media: selectedPost.media.filter((ref) => !sameQdnRef(ref, mediaItem.qdn)) };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost, dataset.categories, dataset.tags));
    setStatus('Media removed from current post. Save draft or publish to persist.');
  }

  function addVideoEmbedToPost() {
    if (!selectedPost || !dataset) return;
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
    setDraft(createDraft(nextPost, dataset.categories, dataset.tags));
    setVideoLinkDraft('');
    setVideoTitleDraft('');
    setError(null);
    setStatus('Video attached to current post. Save draft or publish to persist.');
  }

  function removeVideoEmbedFromPost(video: CmsVideoEmbed) {
    if (!selectedPost || !dataset) return;
    const nextPost = { ...selectedPost, videos: (selectedPost.videos || []).filter((item) => item.id !== video.id) };
    setSelectedPost(nextPost);
    setDraft(createDraft(nextPost, dataset.categories, dataset.tags));
    setStatus('Video removed from current post. Save draft or publish to persist.');
  }

  if (!canManageContent) {
    return (
      <main className="cms-shell admin-access-shell">
        <section className="access-panel">
          <p className="eyebrow">Editorial backend</p>
          <h1>Backend access is not enabled for this Qortal identity</h1>
          <p>Open this app inside Qortal UI with a name that owns the site or is listed as a trusted coauthor.</p>
          <div className="identity-card">
            <User size={17} />
            <div>
              <strong>{identity.name || 'No Qortal name detected'}</strong>
              <span>Role: {identity.role}</span>
              <small>Bridge: {identity.bridgeAvailable ? 'available' : 'not available'}</small>
              <small>Bridge locations: window={String(bridgeDiagnostics.window)}, globalThis={String(bridgeDiagnostics.globalThis)}, parent={String(bridgeDiagnostics.parent)}, top={String(bridgeDiagnostics.top)}, opener={String(bridgeDiagnostics.opener)}, injected={String(bridgeDiagnostics.injectedGlobal)}</small>
              {identity.address && <small>Address: {identity.address}</small>}
              {identity.identityIssue && <small>Identity issue: {identity.identityIssue}</small>}
              <small>Owner target: {ownerTarget}</small>
              <small>Trusted coauthors: {(dataset.manifest.coauthors || []).join(', ') || 'none configured'}</small>
              {identity.names.length > 0 && <small>Detected names: {identity.names.join(', ')}</small>}
            </div>
          </div>
          <a className="icon-command" href="#/">Back to public site</a>
        </section>
      </main>
    );
  }

  return (
    <main className="cms-shell">
      {clipboardNotice && <p className={`clipboard-badge ${clipboardNotice.success ? 'success' : 'error'}`} role="status">{clipboardNotice.message}</p>}
      <aside className="sidebar">
        <div className="brand-block">
          <p>Qortal CMS</p>
          <h1>{dataset.manifest.title}</h1>
          {dataset.manifest.tagline && <small>{dataset.manifest.tagline}</small>}
        </div>

        <nav className="nav-list">
          <a href="#/"><Eye size={17} /> Visit site</a>
          <button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}><Eye size={17} /> Dashboard</button>
          <button className={section === 'posts' ? 'active' : ''} onClick={() => setSection('posts')}><FileText size={17} /> Posts</button>
          <button className={section === 'media' ? 'active' : ''} onClick={() => setSection('media')}><Image size={17} /> Media</button>
          <button className={section === 'imported' ? 'active' : ''} onClick={() => setSection('imported')}><Tags size={17} /> Imported</button>
          <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}><Settings size={17} /> Settings</button>
        </nav>

        <div className="sidebar-version">
          <span>CMS version</span>
          <strong>v{CMS_VERSION}</strong>
        </div>

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
            <label className="filter-box"><Filter size={17} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CmsStatus | 'all')}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option><option value="hidden">Hidden</option></select></label>
            {canManageContent && (
              <div className="post-bulk-toolbar">
                <span>{selectedPostIds.length} selected · max {POST_BULK_LIMIT}</span>
                <button className="icon-command" type="button" onClick={selectVisiblePosts} disabled={isBulkPostAction}><CheckCircle2 size={15} /> Select visible</button>
                <button className="icon-command" type="button" onClick={() => setSelectedPostIds([])} disabled={selectedPostIds.length === 0 || isBulkPostAction}><XCircle size={15} /> Clear</button>
                <label>
                  Status
                  <select value={bulkPostStatus} onChange={(event) => setBulkPostStatus(event.target.value as CmsStatus)} disabled={isBulkPostAction}>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </label>
                <button className="icon-command primary" type="button" onClick={() => void applyBulkPostStatus()} disabled={selectedPostIds.length === 0 || isBulkPostAction}><Save size={15} /> Apply status</button>
                <button className="icon-command danger" type="button" onClick={() => void deleteSelectedPosts()} disabled={selectedPostIds.length === 0 || isBulkPostAction}><Trash2 size={15} /> Delete from CMS</button>
              </div>
            )}
            <div className="post-list">
              {filteredPosts.map((post) => {
                const checked = selectedPostIds.includes(post.id);
                return (
                  <article key={post.id} className={`post-list-row${selectedIndex?.id === post.id ? ' selected' : ''}`}>
                    {canManageContent && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${decodeText(post.title)}`}
                        checked={checked}
                        disabled={isBulkPostAction}
                        onChange={() => togglePostSelection(post.id)}
                      />
                    )}
                    <button type="button" onClick={() => openPost(post)}>
                      <strong>{decodeText(post.title)}</strong>
                      <span>{post.status} · {new Date(post.updated_at).toLocaleString()}</span>
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {section === 'media' && (
          <div className="media-library">
            {canManageMediaLibrary && (
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
            {!canManageMediaLibrary && canManageContent && <small>Media uploads are not enabled for this account.</small>}
            {!isSysop && canManageMediaLibrary && <small>Trusted operator uploads are published under your Qortal name and retained for the Corbett Report catalog.</small>}

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
              {cmsProfile.id !== 'generic' && (
                <div className="import-profile-summary">
                  <strong>{cmsProfile.siteTitle || cmsProfile.id}</strong>
                  <span>Default import source: {cmsProfile.importOwnerName || 'manual'} / {cmsProfile.importManifestIdentifier}</span>
                  <span>Enter the Qortal name that published the selected migration batch. Trusted coauthors can adopt batches from each other.</span>
                  <button className="icon-command" type="button" onClick={applyProfileCatalogPreset}><Settings size={15} /> Use default source</button>
                </div>
              )}
              <label>
                Import source Qortal name
                <input value={importOwnerName} onChange={(event) => setImportOwnerName(event.target.value)} placeholder="Qortal name that published the migrator manifest" />
              </label>
              <label>
                Manifest identifier
                <input value={importManifestIdentifier} onChange={(event) => setImportManifestIdentifier(event.target.value)} placeholder={DEFAULT_IMPORT_MANIFEST_IDENTIFIER} />
              </label>
              <button className="icon-command primary" type="button" onClick={loadImportedManifest}><RefreshCcw size={16} /> Load imported content</button>
            </div>

            {importedManifest && (
              <div className="import-catalog-summary">
                <strong>{importedManifest.publishers?.length ? 'Merged QDN catalog' : 'QDN publisher manifest'}</strong>
                <span>Profile: {importedManifest.profile_id || 'not specified'}</span>
                <span>Canonical site: {importedManifest.canonical_site_name || importOwnerName}</span>
                <span>Public author: {importedManifest.public_author || cmsProfile.publicAuthorName || 'not specified'}</span>
                <span>Publishers: {(importedManifest.publisher_names || importedManifest.publishers?.map((publisher) => publisher.name) || [importOwnerName]).join(', ')}</span>
                <span>Generated: {importedManifest.generated_at ? new Date(importedManifest.generated_at).toLocaleString() : 'not specified'}</span>
                <span>Batch posts: {importedPosts.length}</span>
                <span>Media entries: {Object.keys(importedMediaMap).length}</span>
                <span>Not adopted: {importedPosts.filter((post) => !dataset.posts.some((item) => item.id === `wp-${post.source_id}`)).length}</span>
              </div>
            )}

            {importedPosts.length > 0 && (
              <div className="import-batch-toolbar">
                <span>{selectedImportedIds.length} selected · max {IMPORT_BATCH_LIMIT}</span>
                <button className="icon-command" type="button" onClick={selectVisibleImportedPosts}><CheckCircle2 size={15} /> Select next drafts</button>
                <button className="icon-command" type="button" onClick={() => setSelectedImportedIds([])} disabled={selectedImportedIds.length === 0}><XCircle size={15} /> Clear</button>
                <button className="icon-command primary" type="button" onClick={adoptSelectedImportedPosts} disabled={!canAdoptImportedContent || selectedImportedIds.length === 0}>
                  <Download size={15} /> Adopt selected
                </button>
              </div>
            )}

            {!canAdoptImportedContent && <small>Only the SysOp or a trusted coauthor can adopt migrated WordPress resources into the CMS catalog.</small>}
            {!isSysop && canAdoptImportedContent && <small>Trusted coauthor imports are published under your Qortal name and merged into the Corbett Report catalog.</small>}

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
            <p><strong>CMS profile:</strong> {cmsProfile.id}</p>
            <p><strong>SysOp names:</strong> {[dataset.manifest.owner_name, ...(cmsProfile.sysopNames || [])].filter(Boolean).join(', ')}</p>
            <p><strong>Public author:</strong> {cmsProfile.publicAuthorName || 'per post'}</p>
            <p><strong>Migration catalog:</strong> {cmsProfile.importOwnerName || 'manual'} / {cmsProfile.importManifestIdentifier}</p>
            <p><strong>Site ID:</strong> {dataset.manifest.site_id}</p>
            <p><strong>Manifest:</strong> DOCUMENT / {MANIFEST_IDENTIFIER}</p>
            <p><strong>Posts index:</strong> DOCUMENT / {POSTS_INDEX_IDENTIFIER}</p>

            <section className="site-identity-panel">
              <div className="panel-title"><Settings size={18} /><h3>Site Identity</h3><span>{dataset.manifest.site_id}</span></div>
              <div className="site-identity-form">
                <label>
                  Site title
                  <input value={siteTitleDraft} onChange={(event) => setSiteTitleDraft(event.target.value)} placeholder="My Qortal site" disabled={!isSysop} />
                </label>
                <label>
                  Tagline
                  <textarea value={siteTaglineDraft} onChange={(event) => setSiteTaglineDraft(event.target.value)} placeholder="Short public description" disabled={!isSysop} rows={3} />
                </label>
                <label>
                  Stable site ID
                  <input value={dataset.manifest.site_id} readOnly />
                </label>
                {isSysop ? (
                  <button className="icon-command primary" type="button" onClick={saveSiteIdentity}><Save size={16} /> Save site identity</button>
                ) : (
                  <small>Only the SysOp owner can change site title, tagline, and identity metadata.</small>
                )}
              </div>
            </section>

            <section className="coauthor-panel">
              <div className="panel-title"><User size={18} /><h3>Coauthors</h3><span>{dataset.manifest.coauthors.length}</span></div>
              <small>Coauthors can be added as Qortal names or wallet addresses. Trusted coauthors can publish new posts and adopt migration batches from any trusted import source.</small>
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
              <div><strong>{selectedImportedPost.import?.importer_version || '0.1.5'}</strong><span>importer</span></div>
              <div><strong>{selectedImportedIndex && dataset.posts.some((item) => item.id === `wp-${selectedImportedIndex.source_id}`) ? 'yes' : 'no'}</strong><span>adopted</span></div>
            </div>
            {importedAttachmentSummary(selectedImportedPost, importOwnerName || ownerTarget).length > 0 && (
              <section className="attachments-panel">
                <div className="panel-title"><Paperclip size={18} /><h3>Imported Attachments</h3><span>{importedAttachmentSummary(selectedImportedPost, importOwnerName || ownerTarget).length}</span></div>
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
            <div className="content-preview" onClick={(event) => void handleContentLinkClick(event)} dangerouslySetInnerHTML={{ __html: rewriteImportedHtml(selectedImportedPost, importOwnerName || ownerTarget) }} />
            {canManageContent && (
              <div className="action-row">
                <button className="icon-command primary" type="button" onClick={adoptImportedPost} disabled={!canAdoptImportedContent}><Plus size={16} /> Adopt into CMS draft</button>
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
                <div className="content-preview" onClick={(event) => void handleContentLinkClick(event)} dangerouslySetInnerHTML={{ __html: rewriteCmsContentLinks(selectedPost) }} />
                <MediaAttachmentViewer items={selectedMediaItems} />
                {standaloneVideosForPost(selectedPost).length > 0 && (
                  <section className="attachments-panel">
                    <div className="panel-title"><Video size={18} /><h3>Videos</h3><span>{standaloneVideosForPost(selectedPost).length}</span></div>
                    <div className="video-embed-list">
                      {standaloneVideosForPost(selectedPost).map((video) => (
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
                <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CmsStatus })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option><option value="hidden">Hidden</option></select></label>
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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CmsContentItem, CmsDataset, Gallery, LoadedContent, SectionsDocument, ViewerIdentity } from '../../types';
import { RichTextEditor } from './RichTextEditor';
import { MediaPicker, type InsertedMedia } from './MediaPicker';
import { FeaturedImagePicker, type FeaturedImageChoice } from './FeaturedImagePicker';
import { DraftLists } from './editor/DraftLists';
import { PublishBar } from './editor/PublishBar';
import { ConflictPanel } from './editor/ConflictPanel';
import { EditorFields } from './editor/EditorFields';
import { FeaturedImagePanel } from './editor/FeaturedImagePanel';
import { PreviewModal } from './editor/PreviewModal';
import { LeavePrompt } from './editor/LeavePrompt';
import { ConfirmPublishPanel } from './editor/ConfirmPublishPanel';
import { DeletePostDialog, type DeletePhase } from '../../components/DeletePostDialog';
import type { PublishPhase } from '../../components/ConfirmPublishDialog';
import { draftFromItem, fingerprintSource, resolveTerms, termNames, type QdnRefLike } from './editor/editorUtils';
import {
  createDraft,
  deleteLegacyDrafts,
  legacyDraftCount,
  publicationStateForResult,
  readDrafts,
  removeDraft,
  upsertDraft,
  writeDrafts
} from '../../lib/drafts.js';
import { createScopedStorage, storageScope } from '../../lib/storageScope.js';
import { deleteNativePost, loadNativeIndex, loadOverlay, publishNativePostDraft, publishOverlayDraft, resolveOverlayConflict } from '../../lib/authoring.js';
import { SectionsPicker } from './editor/SectionsPicker';
import { assignmentFor, sameAssignment } from '../../lib/sections.js';
import { prepareMediaResource, quotePublication } from '../../lib/publish.js';
import { attachmentsInHtml, isPublicGatewayUrl, validateAttachment, formatBytes } from '../../lib/attachments.js';
import { attachmentVault, attachmentVaultKey, captureForIdentifier } from '../../lib/attachmentVault.js';
import { getQdnResourceStatus, getTrustedNodeUrl } from '../../lib/qortal.js';
import type { AttachmentStore } from './editor/AttachmentTools';
import { slugAvailable } from '../../lib/nativeCatalog.js';
import {
  finalizeSlug,
  findSlugAnomalies,
  mergeAliases,
  prematureAutoSlugProblem,
  slugify,
  slugProblem,
  slugSetFromItems
} from '../../lib/slug.js';
import {
  autoFeaturedImage,
  normalizeFeaturedImage,
  resolveFeaturedImage
} from '../../lib/featuredImage.js';
import { cmsConfig, templateVersion } from '../../config/cmsConfig';
import {
  CrossPublishPanel,
  emptyCrossPublishSelections,
  type CrossPublishDestination,
  type CrossPublishSelections
} from './editor/CrossPublishPanel';
import type { CrossPublishPlanView, CrossPublishResultView } from './editor/ConfirmPublishPanel';
import { buildCrossPublishPlan, buildSitePostUrl } from '../../lib/crossPublish/plan.js';
import { isQTubeEligibleVideo, QTUBE_PLAYABLE_EXTENSIONS } from '../../lib/crossPublish/qtube.js';
import { resolveSubwireCover } from '../../lib/crossPublish/subwire.js';
import { buildQuitterAnnouncement, QUITTER_TEXT_LIMIT } from '../../lib/crossPublish/quitter.js';
import { createSlugState, reduceSlugState } from '../../lib/slugField.js';
import { findOverlayEntry, overlayContentIdentifier } from '../../lib/overlay.js';
import { createQdnResourceUrl } from '../../lib/qortal.js';
import { stripHtml } from '../../lib/text.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';



export function EditorPage(props: {
  identity: ViewerIdentity;
  name: string;
  siteId: string;
  dataset: CmsDataset | null;
  galleries: Gallery[];
  sections?: SectionsDocument | null;
  /** Effective runtime configuration (site identity, theme, deployment). */
  config?: any;
  loadContent: (item: CmsContentItem) => Promise<LoadedContent>;
  onRefresh: () => void;
  initialId?: string;
  /** Admin section focus: only list and create this content type. */
  contentType?: 'post' | 'page';
}) {
  const siteConfig = props.config || cmsConfig;
  // The configured public author is the editor default. A saved draft or
  // published author always wins; an empty field falls back to this value.
  const configuredAuthor = String(
    (siteConfig.site && siteConfig.site.publicAuthor)
    || (props.dataset && props.dataset.site.publicAuthor)
    || props.identity.name
    || ''
  ).trim();
  const scope = useMemo(() => storageScope({
    deployment: siteConfig.deployment,
    identity: props.identity,
    siteId: props.siteId
  }), [siteConfig.deployment, props.identity, props.siteId]);
  const [draftStore, setDraftStore] = useState<{ key: string; drafts: any[] }>({ key: '', drafts: [] });
  const drafts = scope && draftStore.key === scope.key ? draftStore.drafts : [];
  const persistDrafts = (next: any[]) => {
    if (!scope) return;
    writeDrafts(localStorage, scope, next);
    setDraftStore({ key: scope.key, drafts: next });
  };
  const [legacyCount, setLegacyCount] = useState(0);
  useEffect(() => {
    if (!scope) {
      setDraftStore({ key: '', drafts: [] });
      setLegacyCount(0);
      return;
    }
    // Clear the previous account's drafts before reading the new scope, so an
    // account switch never flashes the previous owner's data.
    setDraftStore({ key: scope.key, drafts: [] });
    setDraftStore({ key: scope.key, drafts: readDrafts(localStorage, scope) });
    setLegacyCount(legacyDraftCount(localStorage, props.siteId));
  }, [scope && scope.key, props.siteId]);
  const [draft, setDraft] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [overlay, setOverlay] = useState<any>(null);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showMedia, setShowMedia] = useState(false);
  const [showFeaturedPicker, setShowFeaturedPicker] = useState(false);
  const [featuredFile, setFeaturedFile] = useState<File | null>(null);
  const [featuredBytes, setFeaturedBytes] = useState<Uint8Array | null>(null);
  const [featuredMeta, setFeaturedMeta] = useState<{ name: string; type: string; size: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fee, setFee] = useState('Checking node fee...');
  const [state, setState] = useState<'idle' | 'publishing' | 'verified' | 'partial' | 'ambiguous' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [advancedSlug, setAdvancedSlug] = useState(false);
  const [slugConfirmChecked, setSlugConfirmChecked] = useState(false);
  const [conflicts, setConflicts] = useState<Record<string, { open: boolean; upstream?: LoadedContent; local?: LoadedContent }>>({});
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [assignment, setAssignment] = useState<{ slugs: string[]; hideFromHome: boolean }>({ slugs: [], hideFromHome: false });
  const initialAssignmentRef = useRef<{ slugs: string[]; hideFromHome: boolean }>({ slugs: [], hideFromHome: false });
  const attachmentStore = useMemo(() => attachmentVault(attachmentVaultKey({ name: props.name, siteId: props.siteId })), [props.name, props.siteId]);
  const [progress, setProgress] = useState<Array<{ stage: string; identifier: string; state: string }>>([]);
  const [crossSelections, setCrossSelections] = useState<CrossPublishSelections>(() => emptyCrossPublishSelections());
  const [quitterText, setQuitterText] = useState('');
  const [quitterTouched, setQuitterTouched] = useState(false);
  const [crossPlan, setCrossPlan] = useState<CrossPublishPlanView | null>(null);
  const [crossVideoMoves, setCrossVideoMoves] = useState<Array<{ from: string; to: string; filename: string; size: number }>>([]);
  const captureFor = (identifier: string) => captureForIdentifier(attachmentStore, identifier, crossVideoMoves);
  const [crossResults, setCrossResults] = useState<CrossPublishResultView[] | null>(null);
  const [planFee, setPlanFee] = useState('');
  const [subwireCoverKind, setSubwireCoverKind] = useState<'featured' | 'generated' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CmsContentItem | null>(null);
  const [deletePhase, setDeletePhase] = useState<DeletePhase>('confirm');
  const [deleteMessage, setDeleteMessage] = useState('');
  const savedRef = useRef<string>('');
  const openedInitialRef = useRef(false);

  useUnsavedGuard(dirty);

  const sectionsChanged = Boolean(draft && draft.type !== 'page' && !sameAssignment(assignment, initialAssignmentRef.current));
  const attachmentPlan = useMemo(() => {
    if (!draft || !draft.html) return [] as ReturnType<typeof attachmentsInHtml>;
    return attachmentsInHtml(draft.html).filter((meta: any) => Boolean(captureFor(meta.identifier)));
  }, [draft && draft.html]);
  const attachmentResourceCount = attachmentPlan.length + attachmentPlan.filter((meta: any) => {
    const capture = captureFor(meta.identifier);
    return Boolean(capture && capture.poster && capture.posterIdentifier !== undefined && meta.poster);
  }).length;
  const qtubeVideos = useMemo(() => {
    if (!draft || !draft.html) return [] as ReturnType<typeof attachmentsInHtml>;
    return attachmentsInHtml(draft.html).filter(isQTubeEligibleVideo);
  }, [draft && draft.html]);
  const qtubeVideo = qtubeVideos[0] || null;
  const effectiveSelections = {
    qtube: qtubeVideos.length > 0 && crossSelections.qtube,
    subwire: crossSelections.subwire,
    quitter: crossSelections.quitter
  };
  const basePublicationResources = (featuredBytes || featuredFile ? 4 : 3)
    + (sectionsChanged ? 1 : 0)
    + attachmentResourceCount;
  const destinationResourceCount = (effectiveSelections.qtube ? qtubeVideos.length : 0)
    + (effectiveSelections.subwire ? 1 : 0)
    + (effectiveSelections.quitter ? 1 : 0)
    + (effectiveSelections.qtube || effectiveSelections.subwire || effectiveSelections.quitter ? 1 : 0);
  const items = useMemo(() => (props.dataset ? [...props.dataset.posts, ...props.dataset.pages] : []), [props.dataset]);
  const nativePosts = useMemo(() => items.filter((item) => item.native), [items]);
  const importedItems = useMemo(() => items.filter((item) => !item.native), [items]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadNativeIndex(props.name, props.siteId), loadOverlay(props.name)]).then(([native, overlayResult]) => {
      if (cancelled) return;
      setRevision(native.ok ? Number(native.index.revision) || 0 : 0);
      if (overlayResult.ok) {
        setOverlay(overlayResult.overlay);
        setOverlayRevision(Number(overlayResult.overlay.revision) || 0);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [props.name]);

  // Both publication paths write exactly three resources: content, the native
  // index or edit overlay, and the search index. A new local featured image is
  // a fourth resource in the same authorized plan.
  useEffect(() => {
    let cancelled = false;
    quotePublication(basePublicationResources + destinationResourceCount)
      .then((quote) => { if (!cancelled) setFee(quote.label); })
      .catch(() => { if (!cancelled) setFee('Fee unavailable.'); });
    return () => { cancelled = true; };
  }, [featuredBytes, featuredFile, sectionsChanged, attachmentResourceCount, destinationResourceCount]);

  // Keep the prefilled Quitter announcement in sync with the post until the
  // owner edits it. The site post link is the product-truth reference.
  useEffect(() => {
    if (!draft || !crossSelections.quitter || quitterTouched) return;
    try {
      setQuitterText(buildQuitterAnnouncement({
        title: draft.title || 'Untitled post',
        excerpt: stripHtml(draft.excerpt || ''),
        postUrl: buildSitePostUrl({
          deployment: siteConfig.deployment,
          name: props.name,
          slug: finalizeSlug(draft.slug || draft.title || '')
        }),
        limit: QUITTER_TEXT_LIMIT
      }));
    } catch {
      setQuitterText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft && draft.title, draft && draft.excerpt, draft && draft.slug, crossSelections.quitter, quitterTouched, props.name]);

  // Detect changed WordPress sources for every local edit. This is a read-only
  // comparison; it never publishes and never renames anything.
  useEffect(() => {
    if (!props.dataset || !overlay || !Array.isArray(overlay.entries) || overlay.entries.length === 0) return undefined;
    let cancelled = false;
    (async () => {
      const next: Record<string, { open: boolean; upstream?: LoadedContent }> = {};
      for (const entry of overlay.entries) {
        const item = items.find((candidate) => String(candidate.id) === String(entry.source_item_id))
          || items.find((candidate) => candidate.type === entry.source_type && (candidate.originalSlug === entry.source_slug || candidate.slug === entry.source_slug));
        if (!item) continue;
        try {
          const sourceRef = item.sourceContentRef || item.contentRef;
          const upstream = await props.loadContent({ ...item, contentRef: sourceRef });
          const hash = await fingerprintSource(upstream, item);
          next[String(entry.source_item_id)] = {
            open: Boolean(entry.base_source_hash && entry.base_source_hash !== hash),
            upstream
          };
        } catch {
          // A withdrawn source is reported as an orphan notice by the catalog.
        }
      }
      if (!cancelled) setConflicts(next);
    })();
    return () => { cancelled = true; };
  }, [overlay, props.dataset, items, props.loadContent]);

  const persist = (next: any) => {
    setDraft(next);
    setDirty(true);
    const updated = upsertDraft(drafts, next);
    persistDrafts(updated);
  };

  const savedSnapshot = (value: any) => JSON.stringify({
    title: value.title, slug: value.slug, html: value.html, excerpt: value.excerpt,
    categoriesText: value.categoriesText, tagsText: value.tagsText, author: value.author, type: value.type,
    featuredImage: value.featuredImage || null, featuredImageUrl: value.featuredImageUrl || '',
    featuredImageAlt: value.featuredImageAlt || '', featuredImageOrigin: value.featuredImageOrigin || null,
    featuredImageSuppressed: value.featuredImageSuppressed === true
  });

  const postIdOf = (value: any) => String(value.sourceKind === 'wordpress-overlay' ? value.sourceItemId : (value.remoteId || value.id));
  const sectionPages = useMemo(() => (props.dataset ? props.dataset.pages.filter((page) => page.native && page.status === 'published') : []), [props.dataset]);

  const openDraftState = (next: any) => {
    const initial = assignmentFor(props.sections || null, postIdOf(next));
    initialAssignmentRef.current = initial;
    setAssignment(initial);
    savedRef.current = savedSnapshot(next);
    setDirty(false);
    setState('idle');
    setMessage('');
    setPreview(false);
    setAdvancedSlug(false);
    setSlugConfirmChecked(false);
    setShowFeaturedPicker(false);
    setFeaturedFile(null);
    setFeaturedBytes(null);
    setFeaturedMeta(null);
    setCrossSelections(emptyCrossPublishSelections());
    setQuitterText('');
    setQuitterTouched(false);
    setCrossPlan(null);
    setCrossResults(null);
    setPlanFee('');
    setSubwireCoverKind(null);
    setDraft(next);
  };

  const startNew = (type: 'post' | 'page' = 'post') => {
    const next = createDraft({
      baseRevision: revision,
      type,
      sourceKind: 'cms-native',
      slugTouched: false,
      slugLocked: false,
      author: configuredAuthor
    });
    openDraftState(next);
  };

  const editDraft = (id: string) => {
    const found = drafts.find((item) => item.id === id);
    if (!found) return;
    openDraftState(found);
  };

  const editPublished = async (id: string) => {
    const item = nativePosts.find((entry) => entry.id === id);
    if (!item) return;
    try {
      const content = await props.loadContent(item);
      const next = draftFromItem(item, content, revision, props.dataset);
      // Preserve the author stored with the published content; only an empty
      // value is filled from the configured public author.
      next.author = next.author || configuredAuthor;
      openDraftState(next);
      const updated = upsertDraft(drafts, next);
      persistDrafts(updated);
    } catch (error) {
      setMessage('Could not load the published post for editing: ' + (error instanceof Error ? error.message : String(error)));
      setState('failed');
    }
  };

  // Deep link support: #/admin/editor/<id> opens a published CMS item once.
  useEffect(() => {
    if (openedInitialRef.current || loading || !props.initialId) return;
    const item = nativePosts.find((entry) => entry.id === props.initialId);
    if (!item) return;
    openedInitialRef.current = true;
    editPublished(item.id);
    // editPublished is a stable operation for this render; the ref prevents loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, props.initialId, nativePosts]);

  /**
   * Open an imported WordPress item for editing. The imported resource is
   * loaded only as the source; the edit itself is stored in the overlay.
   */
  const editImported = async (id: string) => {
    const item = importedItems.find((entry) => entry.id === id);
    if (!item) return;
    try {
      const existingEntry = findOverlayEntry(overlay, item);
      const sourceRef = item.sourceContentRef || item.contentRef;
      const upstream = await props.loadContent({ ...item, contentRef: sourceRef });
      const local = item.edited ? await props.loadContent(item) : upstream;
      const baseSourceHash = existingEntry && existingEntry.base_source_hash
        ? existingEntry.base_source_hash
        : await fingerprintSource(upstream, item);
      // Current canonical slug vs. the original imported slug (identity).
      const originalSlug = item.slug;
      const sourceSlug = item.originalSlug || item.slug;
      const next: any = createDraft({
        id: item.id,
        type: item.type,
        title: local.title || item.title,
        slug: item.slug,
        html: local.html,
        excerpt: item.excerpt,
        categoriesText: termNames(props.dataset, item.categoryIds, 'categories'),
        tagsText: termNames(props.dataset, item.tagIds, 'tags'),
        author: local.author || configuredAuthor,
        status: item.status,
        createdAt: item.createdAt || undefined,
        publishedAt: item.publishedAt,
        baseRevision: overlayRevision,
        remoteId: item.id,
        contentIdentifier: overlayContentIdentifier(props.siteId, item.id),
        slugTouched: true,
        slugLocked: true,
        originalSlug,
        slugAliases: item.slugAliases || (existingEntry ? existingEntry.slug_aliases : []),
        sourceKind: 'wordpress-overlay',
        sourceItemId: item.id,
        sourceSlug,
        sourceRef,
        baseSourceHash,
        baseSourceModifiedAt: upstream.modifiedAt || item.updatedAt || null,
        // Preserve an explicit WordPress featured image until the owner
        // selects, replaces or removes it.
        featuredImage: item.featuredImageRef || null,
        featuredImageUrl: item.featuredImageUrl || '',
        featuredImageAlt: item.featuredImageAlt || '',
        featuredImageManual: Boolean(item.featuredImageRef),
        featuredImageOrigin: item.featuredImageRef ? 'wordpress' : (item.featuredImageSource || null),
        featuredImageSuppressed: false
      });
      next.sourceTitle = upstream.title || item.title;
      next.sourceHtml = upstream.html || '';
      next.sourceExcerpt = stripHtml(upstream.excerptHtml);
      next.sourceModifiedAt = upstream.modifiedAt || item.updatedAt || null;
      next.sourceId = item.legacy ? item.legacy.sourceId : null;
      next.sourceOldUrl = item.legacy ? item.legacy.oldUrl : null;
      next.sourceCategoryIds = item.categoryIds || [];
      next.sourceTagIds = item.tagIds || [];
      next.conflictResolved = false;
      openDraftState(next);
      const updated = upsertDraft(drafts, next);
      persistDrafts(updated);
    } catch (error) {
      setMessage('Could not load the imported post for editing: ' + (error instanceof Error ? error.message : String(error)));
      setState('failed');
    }
  };

  const takenSlugs = useMemo(() => {
    if (!props.dataset || !draft) return new Set<string>();
    const except = [draft.remoteId, draft.sourceItemId].filter(Boolean).map(String);
    return slugSetFromItems([...(props.dataset.posts || []), ...(props.dataset.pages || [])], { exceptIds: except } as any) as Set<string>;
  }, [props.dataset, draft]);

  const slugState = draft
    ? { title: draft.title, slug: draft.slug, touched: Boolean(draft.slugTouched), locked: Boolean(draft.slugLocked) }
    : createSlugState();

  const updateTitle = (value: string) => {
    const next = reduceSlugState(slugState, { type: 'title', value, taken: takenSlugs });
    persist({ ...draft, title: value, slug: next.slug, slugTouched: next.touched, slugLocked: next.locked });
  };

  const updateSlug = (value: string) => {
    const next = reduceSlugState(slugState, { type: 'slug', value });
    persist({ ...draft, slug: next.slug, slugTouched: next.touched, slugLocked: next.locked, slugChangeConfirmed: true });
  };

  const regenerateSlug = () => {
    const next = reduceSlugState(slugState, { type: 'regenerate', taken: takenSlugs });
    persist({ ...draft, slug: next.slug, slugTouched: next.touched, slugLocked: next.locked, slugChangeConfirmed: Boolean(draft.originalSlug) });
  };

  const unlockSlug = () => {
    const next = reduceSlugState(slugState, { type: 'unlock' });
    persist({ ...draft, slug: next.slug, slugTouched: true, slugLocked: false, slugChangeConfirmed: true });
    setAdvancedSlug(false);
    setSlugConfirmChecked(false);
  };

  const cancelSlugChange = () => {
    persist({ ...draft, slug: draft.originalSlug || draft.slug, slugLocked: true, slugChangeConfirmed: false });
    setAdvancedSlug(false);
    setSlugConfirmChecked(false);
  };

  const update = (key: string, value: unknown) => persist({ ...draft, [key]: value });

  const insertMedia = (media: InsertedMedia) => {
    const html = (draft.html || '') + '<p><img src="' + media.url + '" alt="' + media.alt.replace(/"/g, '&quot;') + '" /></p>';
    persist({ ...draft, html });
    setShowMedia(false);
  };

  const mediaUrl = (service: string, name: string, identifier: string) => createQdnResourceUrl(service, name || props.name, identifier);
  const asChoice = (view: any, fallbackSource = 'none'): FeaturedImageChoice => {
    if (!view) return { ref: null, url: '', alt: '', source: fallbackSource };
    const ref = normalizeFeaturedImage(view.ref);
    return {
      ref,
      url: view.url || (ref ? mediaUrl(ref.service, ref.name || props.name, ref.identifier) : ''),
      alt: view.alt || (ref && ref.alt) || '',
      source: view.source || fallbackSource
    };
  };
  const featuredPreviewUrl = useMemo(
    () => featuredBytes
      ? URL.createObjectURL(new Blob([featuredBytes.buffer.slice(featuredBytes.byteOffset, featuredBytes.byteOffset + featuredBytes.byteLength) as ArrayBuffer], { type: (featuredMeta && featuredMeta.type) || 'image/*' }))
      : '',
    [featuredBytes, featuredMeta]
  );
  useEffect(() => () => {
    if (featuredPreviewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(featuredPreviewUrl);
  }, [featuredPreviewUrl]);
  const featuredChoice = useMemo(() => {
    if (featuredBytes) {
      return {
        ref: null,
        url: featuredPreviewUrl,
        alt: ((featuredMeta && featuredMeta.name) || '').replace(/\.[^.]+$/, ''),
        source: 'local-file'
      } as FeaturedImageChoice;
    }
    return asChoice(draft ? resolveFeaturedImage(draft, props.dataset, { name: props.name, createUrl: mediaUrl }) : null);
  }, [draft, props.dataset, props.name, featuredBytes, featuredMeta, featuredPreviewUrl]);
  const automaticChoice = useMemo(
    () => asChoice(draft ? autoFeaturedImage(draft.html, props.dataset, { name: props.name, createUrl: mediaUrl }) : null, 'body'),
    [draft, props.dataset, props.name]
  );

  const selectFeaturedRef = (ref: QdnRefLike) => {
    setFeaturedFile(null);
    setFeaturedBytes(null);
    setFeaturedMeta(null);
    persist({
      ...draft,
      featuredImage: normalizeFeaturedImage(ref),
      featuredImageUrl: '',
      featuredImageAlt: draft.featuredImageAlt || '',
      featuredImageManual: true,
      featuredImageOrigin: 'explicit',
      featuredImageSuppressed: false,
      featuredImagePending: null
    });
    setShowFeaturedPicker(false);
  };

  const selectFeaturedFile = (file: File, bytes: Uint8Array) => {
    setFeaturedFile(file);
    setFeaturedBytes(bytes);
    setFeaturedMeta({ name: file.name, type: file.type || '', size: bytes.length });
    persist({
      ...draft,
      featuredImage: null,
      featuredImageUrl: '',
      featuredImageAlt: draft.featuredImageAlt || file.name.replace(/\.[^.]+$/, ''),
      featuredImageManual: true,
      featuredImageOrigin: 'local-file',
      featuredImageSuppressed: false,
      featuredImagePending: { name: file.name, size: file.size, type: file.type }
    });
  };

  const useAutomaticFeatured = () => {
    setFeaturedFile(null);
    setFeaturedBytes(null);
    setFeaturedMeta(null);
    persist({
      ...draft,
      featuredImage: null,
      featuredImageUrl: '',
      featuredImageAlt: '',
      featuredImageManual: false,
      featuredImageOrigin: 'body',
      featuredImageSuppressed: false,
      featuredImagePending: null
    });
    setShowFeaturedPicker(false);
  };

  const publishWithoutFeatured = () => {
    setFeaturedFile(null);
    setFeaturedBytes(null);
    setFeaturedMeta(null);
    persist({
      ...draft,
      featuredImage: null,
      featuredImageUrl: '',
      featuredImageAlt: '',
      featuredImageManual: false,
      featuredImageOrigin: null,
      featuredImageSuppressed: true,
      featuredImagePending: null
    });
    setShowFeaturedPicker(false);
  };

  const saveLocalDraft = () => {
    const truncated = prematureAutoSlugProblem({
      title: draft.title,
      slug: draft.slug,
      touched: draft.slugTouched,
      locked: draft.slugLocked
    });
    if (truncated) {
      setState('failed');
      setMessage(truncated);
      return;
    }
    const next = { ...draft, publicationState: draft.remoteId ? 'modified-unpublished' : 'draft', publicationMessage: '' };
    persist(next);
    savedRef.current = savedSnapshot(next);
    setDirty(false);
    setState('idle');
    setMessage('Local draft saved. This is not a published update; visitors still see the last published version.');
  };

  const toggleCrossPublish = (destination: CrossPublishDestination, checked: boolean) => {
    setCrossSelections((previous) => ({ ...previous, [destination]: checked }));
    if (destination === 'quitter' && checked) setQuitterTouched(false);
    setCrossPlan(null);
    setCrossResults(null);
    setPlanFee('');
  };

  /**
   * Build the optional destination resources before the single confirmation.
   * Anything that would make a destination invalid aborts here, so the owner
   * never signs a batch that cannot produce a compatible resource.
   */
  const prepareCrossPublishPlan = async (finalSlug: string, selected: CrossPublishSelections) => {
    const html = sanitizeHtml(draft.html);
    const timestamp = Number(draft.publishTimestamp) || Date.now();
    const videos: any[] = [];
    if (selected.qtube) {
      if (!qtubeVideos.length) {
        throw new Error('Q-Tube publication needs an eligible video attachment (' + QTUBE_PLAYABLE_EXTENSIONS.join(', ') + ').');
      }
      for (const candidate of qtubeVideos) {
        if (!candidate) continue;
        const capture = captureFor(candidate.identifier);
        let ready = Boolean(capture);
        if (!ready) {
          const status: any = await getQdnResourceStatus('VIDEO', props.name, candidate.identifier);
          ready = Boolean(status && status.status === 'READY');
        }
        if (!ready) {
          throw new Error('The video attachment "' + candidate.filename + '" is no longer available on this device and is not READY on QDN. Re-attach it or clear the Q-Tube option.');
        }
        videos.push({
          service: 'VIDEO',
          name: props.name,
          identifier: candidate.identifier,
          filename: candidate.filename,
          mime: candidate.mime || '',
          size: Number(candidate.size) || (capture && capture.size) || 0
        });
      }
    }
    let cover: any = null;
    if (selected.subwire) {
      const accent = (siteConfig.theme && siteConfig.theme.colors && siteConfig.theme.colors.accent) || '#1f2937';
      const resolved = await resolveSubwireCover({
        bytes: featuredBytes,
        meta: featuredMeta,
        featured: featuredChoice,
        name: props.name,
        title: draft.title,
        siteTitle: siteConfig.site.title,
        accent
      });
      cover = resolved;
      setSubwireCoverKind(resolved.kind === 'generated' ? 'generated' : 'featured');
    } else {
      setSubwireCoverKind(null);
    }
    const accent = (siteConfig.theme && siteConfig.theme.colors && siteConfig.theme.colors.accent) || '#1f2937';
    return await buildCrossPublishPlan({
      draft: { ...draft, html, slug: finalSlug },
      name: props.name,
      siteId: props.siteId,
      siteTitle: siteConfig.site.title,
      publisherName: props.name,
      postUrl: buildSitePostUrl({ deployment: siteConfig.deployment, name: props.name, slug: finalSlug }),
      video: videos[0] || null,
      videos,
      cover,
      selections: selected,
      quitterText,
      timestamp,
      accent
    });
  };

  const requestPublish = async () => {
    if (!scope) { setState('failed'); setMessage('Verify the owner account before publishing.'); return; }
    if (!draft.title.trim()) { setState('failed'); setMessage('A title is required.'); return; }
    const finalSlug = finalizeSlug(draft.slug || slugify(draft.title));
    const truncated = prematureAutoSlugProblem({
      title: draft.title,
      slug: finalSlug,
      touched: draft.slugTouched,
      locked: draft.slugLocked
    });
    if (truncated) { setState('failed'); setMessage(truncated); return; }
    const problem = slugProblem(finalSlug);
    if (problem) { setState('failed'); setMessage(problem); return; }
    const available = slugAvailable(props.dataset, finalSlug, { exceptIds: [draft.remoteId, draft.sourceItemId].filter(Boolean) });
    if (!available.ok) { setState('failed'); setMessage(available.message); return; }
    if (!draft.html.trim()) { setState('failed'); setMessage('The post body is empty.'); return; }
    if (draft.sourceKind === 'wordpress-overlay' && conflicts[String(draft.sourceItemId)] && conflicts[String(draft.sourceItemId)].open && !draft.conflictResolved) {
      setState('failed');
      setMessage('The WordPress source changed. Resolve the conflict below (keep your edits or accept upstream) before publishing.');
      return;
    }
    const publishedSlug = draft.originalSlug || '';
    if (publishedSlug && publishedSlug !== finalSlug && !draft.slugChangeConfirmed) {
      setState('failed');
      setMessage('The slug of a published item can only change through the advanced slug action.');
      return;
    }

    const selected: CrossPublishSelections = {
      qtube: qtubeVideos.length > 0 && crossSelections.qtube,
      subwire: crossSelections.subwire,
      quitter: crossSelections.quitter
    };
    let plan: CrossPublishPlanView | null = null;
    let exactFee = '';
    if (selected.qtube || selected.subwire || selected.quitter) {
      setState('publishing');
      setMessage('Preparing the optional Q-Tube, Subwire and Quitter resources...');
      try {
        plan = await prepareCrossPublishPlan(finalSlug, selected) as CrossPublishPlanView;
        const quote = await quotePublication(basePublicationResources + plan.resources.length);
        exactFee = quote.label;
        const warnings = [...((plan as any).warnings || [])];
        for (const move of ((plan as any).videoMoves || [])) {
          const status: any = await getQdnResourceStatus('VIDEO', props.name, move.from);
          if (status && status.status === 'READY') {
            warnings.push('The video "' + move.filename + '" is already published under the CMS media identifier ' + move.from
              + ' (' + formatBytes(move.size) + '). Publishing it under ' + move.to
              + ' uploads the same bytes again; the total fee (' + exactFee + ') includes this extra resource.');
          }
        }
        plan = { ...(plan as any), warnings } as CrossPublishPlanView;
        setCrossVideoMoves(((plan as any).videoMoves || []));
      } catch (error) {
        setState('failed');
        setMessage((error instanceof Error ? error.message : String(error)) + ' Nothing was published.');
        return;
      }
      setCrossPlan(plan);
      setPlanFee(exactFee);
    } else {
      setCrossPlan(null);
      setCrossVideoMoves([]);
      setPlanFee('');
    }
    setCrossResults(null);
    setMessage('');
    setState('idle');
    setDraft({ ...draft, slug: finalSlug, publicationState: 'pending-approval' });
    setConfirming(true);
  };

  const publish = async () => {
    // The dialog stays open: progress and the result are shown inside it.
    setState('publishing');
    persist({ ...draft, publicationState: 'pending-confirmation' });
    setMessage('Sanitizing and waiting for Qortal Hub approval...');
    let html = '';
    try {
      html = sanitizeHtml(draft.html);
    } catch (error) {
      setState('failed');
      setMessage('HTML could not be sanitized: ' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    // The video bytes are published once under the Q-Tube identifier; the CMS
    // content must reference that same coordinate.
    for (const move of crossVideoMoves) {
      html = html.split('data-identifier="' + move.from + '"').join('data-identifier="' + move.to + '"');
    }
    const categories = resolveTerms(props.dataset, draft.categoriesText, 'categories');
    const tags = resolveTerms(props.dataset, draft.tagsText, 'tags');
    const timestamp = Number(draft.publishTimestamp) || Date.now();
    const finalSlug = finalizeSlug(draft.slug || draft.title);
    persist({ ...draft, slug: finalSlug, publishTimestamp: timestamp });
    const author = String(draft.author || '').trim() || configuredAuthor;

    // A local featured image joins the single batch: its identifier and
    // reference come from the captured bytes, nothing is published yet.
    let featuredResolved = resolveFeaturedImage(draft, props.dataset, { name: props.name, createUrl: mediaUrl });
    let mediaResources: any[] = [];
    let uploaded: any = null;
    if (featuredBytes) {
      const localName = (featuredMeta && featuredMeta.name) || (featuredFile && featuredFile.name) || 'featured-image';
      try {
        const prepared = await prepareMediaResource({
          name: props.name,
          bytes: featuredBytes,
          filename: localName,
          mimeType: (featuredMeta && featuredMeta.type) || (featuredFile && featuredFile.type) || '',
          title: draft.title,
          description: 'Featured image for ' + draft.title + ' on ' + props.name + '.'
        });
        mediaResources = [prepared.resource];
        uploaded = normalizeFeaturedImage(prepared.ref);
      } catch (error) {
        setState('failed');
        setMessage('The featured image could not be prepared: ' + (error instanceof Error ? error.message : String(error)) + ' The post was not published. Your draft is unchanged.');
        return;
      }
      featuredResolved = {
        ref: uploaded,
        url: uploaded ? mediaUrl(uploaded.service, uploaded.name || props.name, uploaded.identifier) : '',
        alt: draft.featuredImageAlt || localName.replace(/\.[^.]+$/, ''),
        source: 'explicit'
      };
    }
    // Attachments: each is its own content-addressed resource in the same batch.
    const publicNode = isPublicGatewayUrl(getTrustedNodeUrl());
    for (const meta of attachmentsInHtml(html) as any[]) {
      if (meta.name !== props.name) {
        setState('failed');
        setMessage('The attachment "' + meta.filename + '" belongs to a different QDN name and was not published.');
        return;
      }
      const capture = captureFor(meta.identifier);
      if (!capture) {
        const status: any = await getQdnResourceStatus(meta.service, props.name, meta.identifier);
        if (status && status.status === 'READY') continue;
        setState('failed');
        setMessage('The attachment "' + meta.filename + '" is no longer available on this device. Remove it and attach it again. Nothing was published.');
        return;
      }
      const check: any = validateAttachment({ name: capture.filename, size: capture.size, type: capture.mime }, { publicNode });
      if (!check.ok) { setState('failed'); setMessage(check.message + ' Nothing was published.'); return; }
      mediaResources.push({
        stage: 'attachment', service: capture.service, identifier: (capture.service === 'VIDEO'
          ? ((crossVideoMoves.find((item) => item.from === capture.identifier) || {}).to || capture.identifier)
          : capture.identifier), file: capture.blob, sha256: capture.sha256,
        filename: capture.filename, title: meta.title || capture.title,
        description: 'Attachment for ' + draft.title + ' on ' + props.name + '.', reuseIfReady: true
      });
      if (meta.poster && capture.poster) {
        mediaResources.push({
          stage: 'poster', service: 'IMAGE', identifier: meta.poster, bytes: capture.poster.bytes,
          filename: capture.poster.filename, title: 'Poster for ' + (meta.title || capture.title),
          description: 'Video poster for ' + draft.title + ' on ' + props.name + '.', reuseIfReady: true
        });
      }
    }
    // Optional destination resources join the same owner-approved batch.
    const destinationResources = crossPlan ? (crossPlan.resources as any[]) : [];
    if (destinationResources.length) mediaResources.push(...destinationResources);
    setProgress([]);
    setMessage('Waiting for Qortal Hub approval of the combined publication...');

    const publicationDraft = {
      ...draft,
      html,
      slug: finalSlug,
      status: 'published',
      categories,
      tags,
      categoryIds: categories.map((term) => term.id),
      tagIds: tags.map((term) => term.id),
      publishTimestamp: timestamp,
      featuredImageResolved: featuredResolved
    };
    const sectionsPayload = draft.type !== 'page' && !sameAssignment(assignment, initialAssignmentRef.current)
      ? { slugs: assignment.slugs, hideFromHome: assignment.hideFromHome, baseRevision: props.sections ? props.sections.revision : 0 }
      : undefined;
    const result: any = draft.sourceKind === 'wordpress-overlay'
      ? await publishOverlayDraft({
          identity: props.identity,
          name: props.name,
          siteId: props.siteId,
          draft: {
            ...publicationDraft,
            slugAliases: mergeAliases(draft.slugAliases, draft.originalSlug || draft.sourceSlug, finalSlug)
          },
          baseRevision: overlayRevision,
          storage: createScopedStorage(localStorage, scope),
          author,
          timestamp,
          extraResources: mediaResources,
          sectionsAssignment: sectionsPayload,
          onProgress: setProgress
        })
      : await publishNativePostDraft({
          identity: props.identity,
          name: props.name,
          siteId: props.siteId,
          draft: {
            ...publicationDraft,
            slugAliases: mergeAliases(draft.slugAliases, draft.originalSlug, finalSlug)
          },
          baseRevision: revision,
          storage: createScopedStorage(localStorage, scope),
          author,
          timestamp,
          extraResources: mediaResources,
          sectionsAssignment: sectionsPayload,
          onProgress: setProgress
        });
    // Per-destination outcomes come from the batch's per-resource states. The
    // CMS post is judged separately: a failed optional destination must never
    // hide a verified CMS publication.
    const batchResults = Array.isArray((result as any).batchResults) ? (result as any).batchResults : [];
    const destinationStages = ['qtube', 'subwire', 'quitter'];
    const destinationRows: CrossPublishResultView[] = (crossPlan ? crossPlan.entries : []).map((entry) => {
      if (entry.reused) {
        return { id: entry.id, label: entry.label, state: 'reused', message: 'Already published with identical content.' };
      }
      const row = batchResults.find((candidate: any) => candidate.stage === entry.id);
      if (!row) {
        return { id: entry.id, label: entry.label, state: 'not-sent', message: 'The batch ended before this resource was sent.' };
      }
      if (row.ok) {
        return { id: entry.id, label: entry.label, state: 'success', message: row.state === 'reused' ? 'Already present on QDN.' : 'Published and verified.' };
      }
      const state = row.state === 'ambiguous' ? 'ambiguous' : row.state === 'declined' ? 'declined' : 'failed';
      return { id: entry.id, label: entry.label, state, message: row.message || '' };
    });
    const cmsBatchRows = batchResults.filter((row: any) => !destinationStages.includes(String(row.stage)));
    const cmsVerified = batchResults.length > 0
      ? cmsBatchRows.length > 0 && cmsBatchRows.every((row: any) => row.ok)
      : Boolean(result.ok);
    const destinationProblems = destinationRows.filter((row) => row.state !== 'success' && row.state !== 'reused');
    if (crossPlan) {
      setCrossResults([
        {
          id: 'cms',
          label: 'CMS post',
          state: cmsVerified ? 'success' : (result.state === 'ambiguous' ? 'ambiguous' : result.state === 'declined' ? 'declined' : 'failed'),
          message: cmsVerified ? 'Published and verified.' : (result.message || '')
        },
        ...destinationRows
      ]);
    } else {
      setCrossResults(null);
    }

    if (cmsVerified && sectionsPayload) initialAssignmentRef.current = { slugs: [...assignment.slugs], hideFromHome: assignment.hideFromHome };
    if (cmsVerified && uploaded) {
      setFeaturedFile(null);
      setFeaturedBytes(null);
      setFeaturedMeta(null);
    }
    if (cmsVerified) {
      const published = {
        ...draft,
        html,
        slug: finalSlug,
        status: 'published',
        publicationState: 'published',
        publicationMessage: 'Published and verified.',
        remoteId: result.entry ? result.entry.id : (draft.remoteId || draft.sourceItemId),
        contentIdentifier: result.contentIdentifier,
        baseRevision: result.index ? result.index.revision : (result.overlay ? result.overlay.revision : draft.baseRevision),
        publishTimestamp: null,
        publishedAt: new Date().toISOString(),
        slugLocked: true,
        slugTouched: true,
        slugChangeConfirmed: false,
        originalSlug: finalSlug,
        slugAliases: result.slugAliases || [],
        conflictResolved: false,
        featuredImage: featuredResolved.ref || null,
        featuredImageUrl: featuredResolved.ref ? '' : (featuredResolved.url || ''),
        featuredImageAlt: featuredResolved.alt || '',
        featuredImageOrigin: featuredResolved.source || null,
        featuredImageManual: featuredResolved.source === 'explicit',
        featuredImageSuppressed: featuredResolved.source === 'none',
        featuredImagePending: null
      };
      persist(published);
      savedRef.current = savedSnapshot(published);
      setDirty(false);
      if (result.overlay) {
        setOverlay(result.overlay);
        setOverlayRevision(Number(result.overlay.revision) || 0);
      }
      if (result.index) setRevision(result.index.revision);
      setState(destinationProblems.length === 0
        ? 'verified'
        : destinationProblems.some((row) => row.state === 'ambiguous') ? 'ambiguous' : 'partial');
      const baseMessage = draft.sourceKind === 'wordpress-overlay'
        ? 'Your edit is published and verified. The imported WordPress resource is unchanged; an incremental sync will not remove this edit.'
        : 'Published and verified byte-for-byte. A WordPress incremental sync will not remove this post.';
      const destinationMessage = destinationProblems.length === 0
        ? ''
        : ' Destination results — ' + destinationRows.map((row) => row.label + ': ' + row.state).join('; ')
          + '. The CMS post is published; a retry targets the same destination coordinates and will not duplicate publications.';
      setMessage(baseMessage + destinationMessage);
      props.onRefresh();
      return;
    }
    const publicationState = publicationStateForResult(result);
    setState(publicationState === 'ambiguous' ? 'ambiguous' : publicationState === 'partial' ? 'partial' : 'failed');
    persist({ ...draft, publicationState, publicationMessage: result.message || '' });
    setMessage(result.message || 'Publishing failed.');
  };

  const resolveConflict = async (resolution: 'keep-local' | 'accept-upstream') => {
    const conflict = conflicts[String(draft.sourceItemId)];
    const upstream = conflict && conflict.upstream;
    setState('publishing');
    setMessage(resolution === 'keep-local' ? 'Keeping your edits and rebasing the source comparison...' : 'Accepting upstream and removing the local edit...');
    const result: any = await resolveOverlayConflict({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      sourceItemId: draft.sourceItemId,
      resolution,
      baseRevision: overlayRevision,
      storage: createScopedStorage(localStorage, scope),
      currentSourceHash: upstream ? await fingerprintSource(upstream, { legacy: { sourceId: draft.sourceId } } as any) : draft.baseSourceHash,
      currentSourceModifiedAt: upstream ? upstream.modifiedAt : draft.sourceModifiedAt
    });
    if (result.ok) {
      setOverlay(result.overlay);
      setOverlayRevision(Number(result.overlay.revision) || 0);
      props.onRefresh();
      setState('verified');
      setMessage(resolution === 'keep-local'
        ? 'Your local edits stay published. The upstream change was acknowledged and will not be treated as a conflict until the source changes again.'
        : 'The local edit was removed. The imported WordPress content is shown again; the imported resource was never modified.');
      setDraft(null);
      return;
    }
    setState(result.state === 'ambiguous' ? 'ambiguous' : 'failed');
    setMessage(result.message || 'The conflict could not be resolved.');
  };

  const requestDelete = (id: string) => {
    const target = nativePosts.find((item) => String(item.id) === String(id));
    if (!target) return;
    setDeleteTarget(target);
    setDeletePhase('confirm');
    setDeleteMessage('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (!scope) {
      setDeletePhase('error');
      setDeleteMessage('Verify the owner account before deleting.');
      return;
    }
    const target = deleteTarget;
    setDeletePhase('deleting');
    setDeleteMessage('');
    setProgress([]);
    const result: any = await deleteNativePost({
      identity: props.identity,
      name: props.name,
      siteId: props.siteId,
      item: target,
      baseRevision: revision,
      storage: createScopedStorage(localStorage, scope),
      onProgress: setProgress
    });
    if (result.index) setRevision(Number(result.index.revision) || revision);
    if (result.ok) {
      persistDrafts(removeDraft(drafts, target.id));
      setDeletePhase('done');
      setDeleteMessage(result.message || 'Removal confirmed.');
      props.onRefresh();
      return;
    }
    setDeletePhase('error');
    setDeleteMessage(result.message || 'Removal could not be confirmed.');
  };

  const requestLeave = () => {
    if (dirty) setLeavePrompt(true);
    else { setDraft(null); setState('idle'); setMessage(''); }
  };

  const anomalies = useMemo(() => findSlugAnomalies({
    drafts,
    published: [...nativePosts, ...items.filter((item) => item.edited)]
  }), [drafts, nativePosts, items]);

  if (loading) return <p className="muted">Reading the CMS content index and edit overlay...</p>;

  const publishedSlug = draft ? (draft.originalSlug || '') : '';
  const slugChanged = Boolean(publishedSlug && draft && finalizeSlug(draft.slug) !== publishedSlug);
  const autoSlugWarning = draft && !draft.slugLocked
    ? prematureAutoSlugProblem({
        title: draft.title,
        slug: draft.slug,
        touched: draft.slugTouched,
        locked: draft.slugLocked
      })
    : '';
  const publishPhase: PublishPhase = state === 'publishing' ? 'publishing'
    : state === 'verified' ? 'success'
    : state === 'partial' ? 'partial'
    : state === 'ambiguous' ? 'ambiguous'
    : state === 'failed' ? 'error'
    : 'confirm';
  const publishStatusMessage = state === 'ambiguous'
    ? message + ' It was not resent automatically. Retry to verify the pending submission.'
    : message;
  const importedConflict = draft && draft.sourceKind === 'wordpress-overlay' ? conflicts[String(draft.sourceItemId)] : null;
  const sourceKindLabel = draft
    ? draft.sourceKind === 'wordpress-overlay'
      ? 'WordPress-imported post · local edit overlay'
      : draft.remoteId
        ? 'CMS-authored post · published update'
        : 'CMS-authored post · new'
    : '';

  return (
    <section className="admin-section" aria-labelledby="editor-title">
      <h2 id="editor-title">{props.contentType === 'page' ? 'Pages' : props.contentType === 'post' ? 'Posts' : 'Posts and pages'}</h2>
      <p className="muted">
        CMS-authored content lives in a versioned supplement (<code>qms-cms-native-index</code>). WordPress-imported
        posts are edited through a separate versioned overlay (<code>qms-cms-edit-overlay</code>); imported resources
        are never overwritten or deleted. Both use <code>qms-qdn-content@1</code>.
      </p>
      <div className="admin-toolbar">
        {props.contentType !== 'page' ? <button type="button" className="button" onClick={() => startNew('post')}>New post</button> : null}
        {props.contentType !== 'post' ? <button type="button" className={'button' + (props.contentType ? '' : ' button--ghost')} onClick={() => startNew('page')}>New page</button> : null}
        <span className="muted">CMS revision: {revision} · Edit overlay revision: {overlayRevision}</span>
        <span className="muted cms-build-version" role="status">Template v{templateVersion}</span>
      </div>
      <p className="muted cms-build-note">
        Template v{templateVersion}. If this version is older than the release you deployed, the site is still serving a stale Q-App or WEBSITE bundle; republish the verified CMS ZIP before relying on slug or featured-image behaviour.
      </p>

      {legacyCount > 0 ? (
        <div className="state-notice" role="status">
          <p>{legacyCount} old unassigned local draft{legacyCount === 1 ? '' : 's'} on this device. They are hidden and are not tied to any account.</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              deleteLegacyDrafts(localStorage, props.siteId);
              setLegacyCount(0);
            }}
          >
            Delete old local drafts
          </button>
        </div>
      ) : null}
      {!scope ? <p className="muted" role="status">Verify the owner account to see local drafts.</p> : null}

      {!draft ? (
        <>
          <DraftLists
            drafts={props.contentType ? drafts.filter((item) => (item.type || 'post') === props.contentType) : drafts}
            nativePosts={props.contentType ? nativePosts.filter((item) => item.type === props.contentType) : nativePosts}
            importedItems={props.contentType ? importedItems.filter((item) => item.type === props.contentType) : importedItems}
            anomalies={anomalies}
            onEditDraft={editDraft}
            onDeleteDraft={(id) => {
              const next = removeDraft(drafts, id);
              persistDrafts(next);
            }}
            onEditPublished={editPublished}
            onEditImported={editImported}
            onDeletePublished={requestDelete}
          />
        </>
      ) : (
        <>
          <PublishBar
            state={state}
            message={message}
            dirty={dirty}
            sourceKindLabel={sourceKindLabel}
            dialogOpen={confirming}
            onLeave={requestLeave}
            onSaveDraft={saveLocalDraft}
            onPreview={() => setPreview(true)}
            onPublish={requestPublish}
          />

          {importedConflict && importedConflict.open && !draft.conflictResolved ? (
            <ConflictPanel draft={draft} conflict={importedConflict} onResolve={resolveConflict} />
          ) : null}

          <EditorFields
            draft={draft}
            autoSlugWarning={autoSlugWarning}
            slugChanged={slugChanged}
            publishedSlug={publishedSlug}
            advancedSlug={advancedSlug}
            slugConfirmChecked={slugConfirmChecked}
            onTitle={updateTitle}
            onSlug={updateSlug}
            onRegenerate={regenerateSlug}
            onCheckAvailability={() => {
              const suggestion = slugAvailable(props.dataset, draft.slug, { exceptIds: [draft.remoteId, draft.sourceItemId].filter(Boolean) });
              setMessage(suggestion.ok ? 'This slug is available.' : suggestion.message);
            }}
            onOpenAdvanced={() => setAdvancedSlug(true)}
            onCancelAdvanced={() => { setAdvancedSlug(false); setSlugConfirmChecked(false); }}
            onConfirmChecked={setSlugConfirmChecked}
            onUnlock={unlockSlug}
            onCancelSlugChange={cancelSlugChange}
            onUpdate={update}
            categories={props.dataset ? props.dataset.categories : []}
            tags={props.dataset ? props.dataset.tags : []}
          />

          {draft.type !== 'page' ? (
            <SectionsPicker
              pages={sectionPages}
              slugs={assignment.slugs}
              hideFromHome={assignment.hideFromHome}
              onChange={(next) => { setAssignment(next); setDirty(true); }}
            />
          ) : null}

          <FeaturedImagePanel
            draft={draft}
            featuredChoice={featuredChoice}
            automaticChoice={automaticChoice}
            featuredFile={featuredFile}
            onChoose={() => setShowFeaturedPicker(true)}
            onUseAutomatic={useAutomaticFeatured}
            onRemove={publishWithoutFeatured}
          />

          <CrossPublishPanel
            videos={qtubeVideos.map((item: any) => ({ filename: item.filename, size: Number(item.size) || 0 }))}
            selections={crossSelections}
            quitterText={quitterText}
            quitterLimit={QUITTER_TEXT_LIMIT}
            subwireCoverKind={subwireCoverKind}
            onToggle={toggleCrossPublish}
            onQuitterText={(value) => {
              setQuitterText(value);
              setQuitterTouched(true);
              setCrossPlan(null);
              setCrossResults(null);
              setPlanFee('');
            }}
            onRegenerateQuitter={() => setQuitterTouched(false)}
          />

          {draft.remoteId && draft.sourceKind !== 'wordpress-overlay' ? <p className="muted">Editing a published CMS post. Its QDN identity is stable; a title edit does not change the slug.</p> : null}
          {draft.sourceKind === 'wordpress-overlay' ? (
            <p className="muted">
              Editing WordPress source #{draft.sourceId == null ? '(unknown)' : draft.sourceId}
              {draft.sourceOldUrl ? ' · original URL ' + draft.sourceOldUrl : ''}. Imported content ref:{' '}
              <code>{draft.sourceRef ? draft.sourceRef.identifier : '(none)'}</code>.
            </p>
          ) : null}

          <RichTextEditor value={draft.html} onChange={(html) => persist({ ...draft, html })} onInsertMedia={() => setShowMedia(true)} qdnName={props.name} attachmentStore={attachmentStore} publicNode={isPublicGatewayUrl(getTrustedNodeUrl())} />
        </>
      )}

      {showFeaturedPicker && draft ? (
        <FeaturedImagePicker
          identity={props.identity}
          name={props.name}
          datasetMedia={props.dataset ? props.dataset.media : []}
          galleries={props.galleries}
          current={featuredChoice}
          automatic={automaticChoice.url ? automaticChoice : null}
          pendingFile={featuredFile}
          onSelectRef={selectFeaturedRef}
          onSelectFile={selectFeaturedFile}
          onUseAutomatic={useAutomaticFeatured}
          onPublishWithout={publishWithoutFeatured}
          onClose={() => setShowFeaturedPicker(false)}
        />
      ) : null}

      {showMedia && draft ? (
        <MediaPicker
          identity={props.identity}
          name={props.name}
          scope={scope}
          catalogMedia={props.dataset ? props.dataset.media : []}
          galleries={props.galleries}
          onInsert={insertMedia}
          onClose={() => setShowMedia(false)}
        />
      ) : null}

      {preview && draft ? (
        <PreviewModal draft={draft} featuredChoice={featuredChoice} onClose={() => setPreview(false)} />
      ) : null}

      {leavePrompt ? (
        <LeavePrompt
          onSaveAndLeave={() => { saveLocalDraft(); setLeavePrompt(false); setDraft(null); }}
          onDiscard={() => { setLeavePrompt(false); setDraft(null); setDirty(false); }}
          onStay={() => setLeavePrompt(false)}
        />
      ) : null}

      {deleteTarget ? (
        <DeletePostDialog
          item={deleteTarget}
          phase={deletePhase}
          message={deleteMessage}
          onConfirm={confirmDelete}
          onClose={() => { if (deletePhase !== 'deleting') setDeleteTarget(null); }}
        />
      ) : null}

      {confirming ? (
        <ConfirmPublishPanel
          draft={draft}
          name={props.name}
          identity={props.identity}
          revision={revision}
          overlayRevision={overlayRevision}
          featuredBytes={featuredBytes}
          featuredMeta={featuredMeta}
          featuredFile={featuredFile}
          featuredChoice={featuredChoice}
          fee={planFee || fee}
          crossPlan={crossPlan}
          crossResults={crossResults}
          attachments={attachmentPlan.map((meta: any) => ({ service: meta.service, identifier: meta.identifier, filename: meta.filename, size: meta.size, poster: Boolean(meta.poster) }))}
          progress={progress}
          sectionsChange={sectionsChanged ? { slugs: assignment.slugs, hideFromHome: assignment.hideFromHome, revision: (props.sections ? props.sections.revision : 0) + 1 } : null}
          slugChanged={slugChanged}
          publishedSlug={publishedSlug}
          phase={publishPhase}
          statusMessage={publishStatusMessage}
          onConfirm={publish}
          onCancel={() => { setConfirming(false); setCrossPlan(null); setPlanFee(''); }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CmsContentItem, CmsDataset, Gallery, LoadedContent, ViewerIdentity } from '../../types';
import { RichTextEditor } from './RichTextEditor';
import { MediaPicker, type InsertedMedia } from './MediaPicker';
import { FeaturedImagePicker, type FeaturedImageChoice } from './FeaturedImagePicker';
import { StateNotice } from '../../components/StateNotice';
import {
  PUBLICATION_STATE_LABELS,
  createDraft,
  parseTerms,
  publicationStateForResult,
  readDrafts,
  removeDraft,
  upsertDraft,
  writeDrafts
} from '../../lib/drafts.js';
import { loadNativeIndex, loadOverlay, publishNativePostDraft, publishOverlayDraft, resolveOverlayConflict } from '../../lib/authoring.js';
import { publishMediaFile, quotePublication } from '../../lib/publish.js';
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
  FEATURED_IMAGE_HELP,
  autoFeaturedImage,
  normalizeFeaturedImage,
  resolveFeaturedImage
} from '../../lib/featuredImage.js';
import { templateVersion } from '../../config/cmsConfig';
import { createSlugState, reduceSlugState } from '../../lib/slugField.js';
import { findOverlayEntry, overlayContentIdentifier, sourceFingerprint } from '../../lib/overlay.js';
import { createQdnResourceUrl, sha256Hex } from '../../lib/qortal.js';
import { stripHtml } from '../../lib/text.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';

type QdnRefLike = { service: string; name?: string; identifier: string };

function termNames(dataset: CmsDataset | null, ids: string[] | undefined, kind: 'categories' | 'tags') {
  if (!dataset) return '';
  const terms = kind === 'categories' ? dataset.categories : dataset.tags;
  return (ids || [])
    .map((id) => {
      const term = terms.find((entry) => entry.id === id);
      return term ? term.name : id;
    })
    .join(', ');
}

function resolveTerms(dataset: CmsDataset | null, text: string, kind: 'categories' | 'tags') {
  const terms = dataset ? (kind === 'categories' ? dataset.categories : dataset.tags) : [];
  return parseTerms(text).map((name) => {
    const key = name.toLowerCase();
    const existing = terms.find((term) => term.name.toLowerCase() === key || term.id.toLowerCase() === key);
    if (existing) return { id: existing.id, name: existing.name, slug: existing.slug };
    return {
      id: (kind === 'categories' ? 'cms-category-' : 'cms-tag-') + slugify(name),
      name,
      slug: slugify(name)
    };
  });
}

function draftFromItem(item: CmsContentItem, content: LoadedContent, revision: number, dataset: CmsDataset | null) {
  return createDraft({
    id: item.id,
    type: item.type,
    title: content.title || item.title,
    slug: item.slug,
    html: content.html,
    excerpt: item.excerpt,
    categoriesText: termNames(dataset, item.categoryIds, 'categories'),
    tagsText: termNames(dataset, item.tagIds, 'tags'),
    author: content.author,
    status: item.status,
    createdAt: item.createdAt || undefined,
    publishedAt: item.publishedAt,
    baseRevision: revision,
    remoteId: item.id,
    contentIdentifier: item.contentRef ? item.contentRef.identifier : null,
    // Published identity: a title edit must never change the slug.
    slugTouched: true,
    slugLocked: true,
    originalSlug: item.slug,
    slugAliases: item.slugAliases || [],
    sourceKind: 'cms-native',
    featuredImage: item.featuredImageRef || null,
    featuredImageUrl: item.featuredImageUrl || '',
    featuredImageAlt: item.featuredImageAlt || '',
    featuredImageManual: Boolean(item.featuredImageRef) && item.featuredImageSource !== 'body',
    featuredImageOrigin: item.featuredImageSource || (item.featuredImageRef ? 'published' : null),
    featuredImageSuppressed: false
  });
}

async function fingerprintSource(content: LoadedContent, item: CmsContentItem) {
  const text = sourceFingerprint({
    title: content.title,
    html: content.html,
    excerpt: stripHtml(content.excerptHtml),
    modifiedAt: content.modifiedAt,
    sourceId: item.legacy ? item.legacy.sourceId : null
  });
  return 'sha256:' + await sha256Hex(new TextEncoder().encode(text));
}

function publicationLabel(state: string) {
  return (PUBLICATION_STATE_LABELS as Record<string, string>)[state] || state;
}

export function EditorPage(props: {
  identity: ViewerIdentity;
  name: string;
  siteId: string;
  dataset: CmsDataset | null;
  galleries: Gallery[];
  loadContent: (item: CmsContentItem) => Promise<LoadedContent>;
  onRefresh: () => void;
  initialId?: string;
}) {
  const [drafts, setDrafts] = useState<any[]>(() => readDrafts(localStorage, props.siteId));
  const [draft, setDraft] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [overlay, setOverlay] = useState<any>(null);
  const [overlayRevision, setOverlayRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showMedia, setShowMedia] = useState(false);
  const [showFeaturedPicker, setShowFeaturedPicker] = useState(false);
  const [featuredFile, setFeaturedFile] = useState<File | null>(null);
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
  const savedRef = useRef<string>('');
  const openedInitialRef = useRef(false);

  useUnsavedGuard(dirty);

  const items = useMemo(() => (props.dataset ? [...props.dataset.posts, ...props.dataset.pages] : []), [props.dataset]);
  const nativePosts = useMemo(() => items.filter((item) => item.native), [items]);
  const importedItems = useMemo(() => items.filter((item) => !item.native), [items]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadNativeIndex(props.name), loadOverlay(props.name)]).then(([native, overlayResult]) => {
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
    quotePublication(featuredFile ? 4 : 3)
      .then((quote) => { if (!cancelled) setFee(quote.label); })
      .catch(() => { if (!cancelled) setFee('Fee unavailable.'); });
    return () => { cancelled = true; };
  }, [featuredFile]);

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
    setDrafts(updated);
    writeDrafts(localStorage, props.siteId, updated);
  };

  const savedSnapshot = (value: any) => JSON.stringify({
    title: value.title, slug: value.slug, html: value.html, excerpt: value.excerpt,
    categoriesText: value.categoriesText, tagsText: value.tagsText, author: value.author, type: value.type,
    featuredImage: value.featuredImage || null, featuredImageUrl: value.featuredImageUrl || '',
    featuredImageAlt: value.featuredImageAlt || '', featuredImageOrigin: value.featuredImageOrigin || null,
    featuredImageSuppressed: value.featuredImageSuppressed === true
  });

  const openDraftState = (next: any) => {
    savedRef.current = savedSnapshot(next);
    setDirty(false);
    setState('idle');
    setMessage('');
    setPreview(false);
    setAdvancedSlug(false);
    setSlugConfirmChecked(false);
    setShowFeaturedPicker(false);
    setFeaturedFile(null);
    setDraft(next);
  };

  const startNew = (type: 'post' | 'page' = 'post') => {
    const next = createDraft({ baseRevision: revision, type, sourceKind: 'cms-native', slugTouched: false, slugLocked: false });
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
      openDraftState(next);
      const updated = upsertDraft(drafts, next);
      setDrafts(updated);
      writeDrafts(localStorage, props.siteId, updated);
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
        author: local.author || '',
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
      setDrafts(updated);
      writeDrafts(localStorage, props.siteId, updated);
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
  const featuredChoice = useMemo(() => {
    if (featuredFile) {
      return {
        ref: null,
        url: URL.createObjectURL(featuredFile),
        alt: featuredFile.name.replace(/\.[^.]+$/, ''),
        source: 'local-file'
      } as FeaturedImageChoice;
    }
    return asChoice(draft ? resolveFeaturedImage(draft, props.dataset, { name: props.name, createUrl: mediaUrl }) : null);
  }, [draft, props.dataset, props.name, featuredFile]);
  const automaticChoice = useMemo(
    () => asChoice(draft ? autoFeaturedImage(draft.html, props.dataset, { name: props.name, createUrl: mediaUrl }) : null, 'body'),
    [draft, props.dataset, props.name]
  );

  const selectFeaturedRef = (ref: QdnRefLike) => {
    setFeaturedFile(null);
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

  const selectFeaturedFile = (file: File) => {
    setFeaturedFile(file);
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

  const requestPublish = () => {
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
    setMessage('');
    setState('idle');
    setDraft({ ...draft, slug: finalSlug, publicationState: 'pending-approval' });
    setConfirming(true);
  };

  const publish = async () => {
    setConfirming(false);
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
    const categories = resolveTerms(props.dataset, draft.categoriesText, 'categories');
    const tags = resolveTerms(props.dataset, draft.tagsText, 'tags');
    const timestamp = Number(draft.publishTimestamp) || Date.now();
    const finalSlug = finalizeSlug(draft.slug || draft.title);
    persist({ ...draft, slug: finalSlug, publishTimestamp: timestamp });
    const author = (props.dataset && props.dataset.site.publicAuthor) || props.identity.name;

    // A local featured image is published first, through the same owner-guarded
    // media plan (fee, collision check and byte-exact read-back). The post is
    // only published after the image is confirmed or safely reused.
    let featuredResolved = resolveFeaturedImage(draft, props.dataset, { name: props.name, createUrl: mediaUrl });
    if (featuredFile) {
      setMessage('Publishing the featured image and waiting for Qortal Hub approval...');
      const mediaResult = await publishMediaFile({
        identity: props.identity,
        name: props.name,
        file: featuredFile,
        title: draft.title,
        description: 'Featured image for ' + draft.title + ' on ' + props.name + '.',
        storage: localStorage as any
      });
      if (!mediaResult.ok || !mediaResult.ref) {
        setState('failed');
        setMessage('The featured image was not published: ' + (mediaResult.message || 'unknown error') + ' The post was not published.');
        return;
      }
      const uploaded = normalizeFeaturedImage(mediaResult.ref);
      featuredResolved = {
        ref: uploaded,
        url: uploaded ? mediaUrl(uploaded.service, uploaded.name || props.name, uploaded.identifier) : '',
        alt: draft.featuredImageAlt || featuredFile.name.replace(/\.[^.]+$/, ''),
        source: 'explicit'
      };
      setFeaturedFile(null);
      persist({
        ...draft,
        featuredImage: uploaded,
        featuredImageOrigin: 'explicit',
        featuredImageManual: true,
        featuredImageSuppressed: false,
        featuredImagePending: null
      });
      setMessage('Featured image published and verified. Publishing the post now...');
    }

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
          storage: localStorage,
          author,
          timestamp
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
          storage: localStorage,
          author,
          timestamp
        });
    if (result.ok) {
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
      setState('verified');
      setMessage(
        draft.sourceKind === 'wordpress-overlay'
          ? 'Your edit is published and verified. The imported WordPress resource is unchanged; an incremental sync will not remove this edit.'
          : 'Published and verified byte-for-byte. A WordPress incremental sync will not remove this post.'
      );
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
      storage: localStorage,
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
      <h2 id="editor-title">Posts and pages</h2>
      <p className="muted">
        CMS-authored content lives in a versioned supplement (<code>qms-cms-native-index</code>). WordPress-imported
        posts are edited through a separate versioned overlay (<code>qms-cms-edit-overlay</code>); imported resources
        are never overwritten or deleted. Both use <code>qms-qdn-content@1</code>.
      </p>
      <div className="admin-toolbar">
        <button type="button" className="button" onClick={() => startNew('post')}>New post</button>
        <button type="button" className="button button--ghost" onClick={() => startNew('page')}>New page</button>
        <span className="muted">CMS revision: {revision} · Edit overlay revision: {overlayRevision}</span>
        <span className="muted cms-build-version" role="status">Template v{templateVersion}</span>
      </div>
      <p className="muted cms-build-note">
        Template v{templateVersion}. If this version is older than the release you deployed, the site is still serving a stale Q-App or WEBSITE bundle; republish the verified CMS ZIP before relying on slug or featured-image behaviour.
      </p>

      {!draft ? (
        <>
          <h3>Local drafts</h3>
          <p className="muted">Saved only in this browser. A local draft is not a published update.</p>
          {drafts.length === 0 ? <p className="muted">No local drafts yet.</p> : (
            <ul className="admin-list">
              {drafts.map((item) => (
                <li key={item.id} className="admin-list__item">
                  <button type="button" className="button button--ghost" onClick={() => editDraft(item.id)}>
                    {item.title || '(untitled)'}
                    <span className="admin-list__meta">{publicationLabel(item.publicationState || 'draft')} · /{item.slug || 'no-slug'}</span>
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => {
                    const next = removeDraft(drafts, item.id);
                    setDrafts(next);
                    writeDrafts(localStorage, props.siteId, next);
                  }}>Delete draft</button>
                </li>
              ))}
            </ul>
          )}

          <h3>CMS-authored posts and pages</h3>
          {nativePosts.length === 0 ? <p className="muted">No CMS-authored content published yet.</p> : (
            <ul className="admin-list">
              {nativePosts.map((item) => (
                <li key={item.id} className="admin-list__item">
                  <span>{item.title} <span className="admin-list__meta">{item.type} · /{item.slug} · {item.status} · CMS-authored</span></span>
                  <button type="button" className="button button--ghost" aria-label={'Edit ' + item.title} onClick={() => editPublished(item.id)}>Edit</button>
                </li>
              ))}
            </ul>
          )}

          <h3>Imported WordPress posts and pages</h3>
          <p className="muted">
            Edits are stored locally in QDN as an overlay. The WordPress source metadata, original URL and QDN identity
            are preserved; the imported resources stay byte-for-byte unchanged.
          </p>
          {importedItems.length === 0 ? <p className="muted">No imported content in the catalog.</p> : (
            <ul className="admin-list">
              {importedItems.map((item) => (
                <li key={item.id} className="admin-list__item">
                  <span>
                    {item.title}{' '}
                    <span className="admin-list__meta">
                      {item.type} · /{item.slug}
                      {item.legacy && item.legacy.sourceId != null ? ' · WP source #' + item.legacy.sourceId : ' · WordPress-imported'}
                      {item.edited ? ' · local edit published' : ''}
                    </span>
                  </span>
                  <button type="button" className="button button--ghost" aria-label={'Edit ' + item.title} onClick={() => editImported(item.id)}>Edit</button>
                </li>
              ))}
            </ul>
          )}

          <h3>Slug health and repair</h3>
          <p className="muted">
            Detection only. Published resources are never renamed automatically; a published slug change requires the
            explicit advanced workflow and preserves the old URL as an alias.
          </p>
          {anomalies.length === 0 ? <p className="muted">No suspicious one-character slugs detected.</p> : (
            <ul className="admin-list">
              {anomalies.map((finding) => (
                <li key={finding.kind + finding.id} className="admin-list__item">
                  <span>
                    {finding.title || '(untitled)'}{' '}
                    <span className="admin-list__meta">{finding.published ? 'published' : 'draft'} · /{finding.slug} → expected /{finding.expected || '(none)'}</span>
                  </span>
                  <span className="admin-list__meta">{finding.safeAction}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="admin-toolbar">
            <button type="button" className="button button--ghost" onClick={requestLeave}>← All posts</button>
            <button type="button" className="button button--ghost" onClick={saveLocalDraft}>Save draft</button>
            <button type="button" className="button button--ghost" onClick={() => setPreview(true)}>Preview</button>
            <button type="button" className="button" onClick={requestPublish} disabled={state === 'publishing'}>Publish post…</button>
          </div>
          <p className="editor-source-kind" role="status">{sourceKindLabel}</p>
          {message ? <p className="admin-message" role="status" aria-live="polite">{message}</p> : null}
          {dirty ? <p className="preview-banner" role="status">Unsaved changes — save a local draft or publish. A local draft is not a published update.</p> : null}

          {state === 'ambiguous' ? <StateNotice state="partial" title="Publication unconfirmed" message={message + ' It was not resent automatically. Retry to verify the pending submission.'} /> : null}
          {state === 'partial' ? <StateNotice state="partial" title="Published, search index pending" message={message} /> : null}
          {state === 'failed' ? <StateNotice state="error" title="Not published" message={message} /> : null}
          {state === 'verified' ? <StateNotice state="partial" title="Published and verified" message={message} /> : null}

          {importedConflict && importedConflict.open && !draft.conflictResolved ? (
            <section className="conflict-panel" aria-labelledby="conflict-title" role="alert">
              <h3 id="conflict-title">The WordPress source changed after your edit</h3>
              <p className="muted">
                Your local edit is still published and visible. Choose what to keep. Nothing is overwritten
                automatically and the imported resource is never modified.
              </p>
              <dl className="meta-grid">
                <div><dt>Your published title</dt><dd>{draft.title}</dd></div>
                <div><dt>Upstream title now</dt><dd>{importedConflict.upstream ? importedConflict.upstream.title : '(unavailable)'}</dd></div>
                <div><dt>Your excerpt</dt><dd>{draft.excerpt || '(none)'}</dd></div>
                <div><dt>Upstream excerpt</dt><dd>{importedConflict.upstream ? stripHtml(importedConflict.upstream.excerptHtml) : '(unavailable)'}</dd></div>
              </dl>
              <div className="admin-toolbar">
                <button type="button" className="button" onClick={() => resolveConflict('keep-local')}>Keep my edits</button>
                <button type="button" className="button button--ghost" onClick={() => resolveConflict('accept-upstream')}>Accept upstream</button>
              </div>
            </section>
          ) : null}

          <div className="editor-fields">
            <label>Title<input value={draft.title} maxLength={200} onChange={(event) => updateTitle(event.target.value)} /></label>
            <label>
              Slug
              <input
                value={draft.slug}
                onChange={(event) => updateSlug(event.target.value)}
                disabled={draft.slugLocked}
                aria-describedby="slug-help"
                inputMode="url"
                spellCheck={false}
              />
            </label>
            <p id="slug-help" className="muted">
              {draft.slugLocked
                ? 'Locked because this item is published. Editing the title never changes a published slug.'
                : draft.slugTouched
                  ? 'Manual slug. Further title changes will not overwrite it.'
                  : 'Generated from the complete title; keeps updating until you edit it.'}
              {' '}
              {draft.slug ? <span>Final slug: <code>{finalizeSlug(draft.slug)}</code></span> : null}
            </p>
            {autoSlugWarning ? (
              <p className="slug-warning" role="alert">
                {autoSlugWarning}{' '}
                <button type="button" className="button button--ghost" onClick={regenerateSlug}>Regenerate slug now</button>
              </p>
            ) : null}
            <div className="admin-toolbar">
              <button type="button" className="button button--ghost" onClick={regenerateSlug} disabled={draft.slugLocked}>Regenerate slug</button>
              {draft.slug && !draft.slugLocked ? (
                <button type="button" className="button button--ghost" onClick={() => {
                  const suggestion = slugAvailable(props.dataset, draft.slug, { exceptIds: [draft.remoteId, draft.sourceItemId].filter(Boolean) });
                  setMessage(suggestion.ok ? 'This slug is available.' : suggestion.message);
                }}>Check availability</button>
              ) : null}
              {draft.slugLocked ? (
                <button type="button" className="button button--ghost" onClick={() => setAdvancedSlug(true)}>Change slug (advanced)…</button>
              ) : null}
            </div>

            {advancedSlug && draft.slugLocked ? (
              <section className="advanced-slug" aria-labelledby="advanced-slug-title">
                <h3 id="advanced-slug-title">Change a published slug</h3>
                <p>
                  The old URL stays valid as an alias in this CMS. The old QDN content resource is kept, never
                  overwritten or deleted. External links that use the QDN resource identifier keep working. The new
                  version is published under a new identifier and needs its own Hub approval and fee.
                </p>
                <label className="check-row">
                  <input type="checkbox" checked={slugConfirmChecked} onChange={(event) => setSlugConfirmChecked(event.target.checked)} />
                  I understand the consequences and want to change this published slug.
                </label>
                <div className="admin-toolbar">
                  <button type="button" className="button" disabled={!slugConfirmChecked} onClick={unlockSlug}>Unlock slug field</button>
                  <button type="button" className="button button--ghost" onClick={() => { setAdvancedSlug(false); setSlugConfirmChecked(false); }}>Cancel</button>
                </div>
              </section>
            ) : null}

            {slugChanged && !draft.slugLocked ? (
              <p className="preview-banner" role="status">
                Slug will change from <code>{publishedSlug}</code> to <code>{finalizeSlug(draft.slug)}</code>. The old
                URL will resolve through an alias.
                <button type="button" className="button button--ghost" onClick={cancelSlugChange}>Cancel slug change</button>
              </p>
            ) : null}

            <label>Excerpt<textarea rows={2} value={draft.excerpt} onChange={(event) => update('excerpt', event.target.value)} /></label>
            <label>Categories (comma separated)<input value={draft.categoriesText} onChange={(event) => update('categoriesText', event.target.value)} /></label>
            <label>Tags (comma separated)<input value={draft.tagsText} onChange={(event) => update('tagsText', event.target.value)} /></label>
            <label>Author<input value={draft.author} onChange={(event) => update('author', event.target.value)} /></label>
            {!draft.remoteId && !draft.sourceItemId ? (
              <label>Content type
                <select value={draft.type} onChange={(event) => update('type', event.target.value)}>
                  <option value="post">Post</option>
                  <option value="page">Page</option>
                </select>
              </label>
            ) : null}
          </div>

          <section className="featured-editor" aria-labelledby="featured-editor-title">
            <h3 id="featured-editor-title">Featured image</h3>
            <p className="muted">{FEATURED_IMAGE_HELP}</p>
            <div className="featured-editor__row">
              {featuredChoice.url ? (
                <img className="featured-editor__preview" src={featuredChoice.url} alt={featuredChoice.alt || 'Featured image preview'} />
              ) : (
                <div className="featured-editor__preview featured-editor__preview--empty" aria-hidden="true">No image</div>
              )}
              <div className="featured-editor__body">
                <p className="featured-editor__source" role="status">
                  {featuredChoice.source === 'explicit' ? 'Selected by you' : null}
                  {featuredChoice.source === 'wordpress' ? 'Preserved WordPress featured image' : null}
                  {featuredChoice.source === 'body' ? 'Automatic: first suitable image in the post body' : null}
                  {featuredChoice.source === 'published' ? 'Published featured image' : null}
                  {featuredChoice.source === 'local-file' ? 'New local image, published when you confirm' : null}
                  {featuredChoice.source === 'none' ? 'No featured image will be published' : null}
                  {draft.featuredImagePending && !featuredFile ? ' · re-select ' + draft.featuredImagePending.name : ''}
                </p>
                <div className="admin-toolbar">
                  <button type="button" className="button" onClick={() => setShowFeaturedPicker(true)}>
                    {featuredChoice.url ? 'Replace featured image' : 'Choose featured image'}
                  </button>
                  {automaticChoice.url ? (
                    <button type="button" className="button button--ghost" onClick={useAutomaticFeatured} disabled={featuredChoice.source === 'body'}>
                      Use automatic image
                    </button>
                  ) : null}
                  <button type="button" className="button button--ghost" onClick={publishWithoutFeatured} disabled={!featuredChoice.url && featuredChoice.source === 'none'}>
                    Remove featured image
                  </button>
                </div>
              </div>
            </div>
          </section>

          {draft.remoteId && draft.sourceKind !== 'wordpress-overlay' ? <p className="muted">Editing a published CMS post. Its QDN identity is stable; a title edit does not change the slug.</p> : null}
          {draft.sourceKind === 'wordpress-overlay' ? (
            <p className="muted">
              Editing WordPress source #{draft.sourceId == null ? '(unknown)' : draft.sourceId}
              {draft.sourceOldUrl ? ' · original URL ' + draft.sourceOldUrl : ''}. Imported content ref:{' '}
              <code>{draft.sourceRef ? draft.sourceRef.identifier : '(none)'}</code>.
            </p>
          ) : null}

          <RichTextEditor value={draft.html} onChange={(html) => persist({ ...draft, html })} onInsertMedia={() => setShowMedia(true)} />
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
          catalogMedia={props.dataset ? props.dataset.media : []}
          galleries={props.galleries}
          onInsert={insertMedia}
          onClose={() => setShowMedia(false)}
        />
      ) : null}

      {preview && draft ? (
        <div className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
          <div className="preview-modal__bar">
            <h3 id="preview-title">Preview: {draft.title || '(untitled)'}</h3>
            <button type="button" className="button button--ghost" onClick={() => setPreview(false)}>Close preview</button>
          </div>
          <p className="muted">Slug: /{finalizeSlug(draft.slug)} · Preview only, not published.</p>
          <article className="post-body">
            <h1>{draft.title}</h1>
            {featuredChoice.url ? <img className="article-image" src={featuredChoice.url} alt={featuredChoice.alt || draft.title} /> : null}
            {draft.excerpt ? <p className="post-card__excerpt">{draft.excerpt}</p> : null}
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(draft.html) }} />
          </article>
        </div>
      ) : null}

      {leavePrompt ? (
        <div className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <h3 id="leave-title">Unsaved changes</h3>
          <p>Save a local draft before leaving? A local draft is not a published update.</p>
          <div className="admin-toolbar">
            <button type="button" className="button" onClick={() => { saveLocalDraft(); setLeavePrompt(false); setDraft(null); }}>Save draft and leave</button>
            <button type="button" className="button button--ghost" onClick={() => { setLeavePrompt(false); setDraft(null); setDirty(false); }}>Discard changes</button>
            <button type="button" className="button button--ghost" onClick={() => setLeavePrompt(false)}>Stay</button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-post-title">
          <h3 id="confirm-post-title">Confirm post publication</h3>
          <dl className="meta-grid">
            <div><dt>Title</dt><dd>{draft.title}</dd></div>
            <div><dt>Final slug</dt><dd><code>{finalizeSlug(draft.slug)}</code></dd></div>
            <div><dt>Content</dt><dd>DOCUMENT / {props.name} / {draft.contentIdentifier || 'stable slug identifier'}</dd></div>
            <div><dt>Index</dt><dd>{draft.sourceKind === 'wordpress-overlay' ? 'DOCUMENT / ' + props.name + ' / qms-cms-edit-overlay (revision ' + (overlayRevision + 1) + ')' : 'DOCUMENT / ' + props.name + ' / qms-cms-native-index (revision ' + (revision + 1) + ')'}</dd></div>
            <div><dt>Featured image</dt><dd>{featuredFile ? 'New local image / ' + featuredFile.name : featuredChoice.url ? (featuredChoice.ref ? 'QDN IMAGE / ' + (featuredChoice.ref.name || props.name) + ' / ' + featuredChoice.ref.identifier : featuredChoice.url) : 'None'}{featuredFile ? ' (fee includes one image resource)' : ''}</dd></div>
            <div><dt>Fee</dt><dd>{fee}</dd></div>
            <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
            {slugChanged ? <div><dt>Slug change</dt><dd>Old slug /{publishedSlug} becomes an alias; old content resource is kept.</dd></div> : null}
          </dl>
          <p className="muted">HTML is sanitized before publication. Ownership is revalidated immediately before each signature.</p>
          <div className="admin-toolbar">
            <button type="button" className="button" onClick={publish}>Confirm publish</button>
            <button type="button" className="button button--ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

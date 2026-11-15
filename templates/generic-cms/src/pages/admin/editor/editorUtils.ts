import type { CmsContentItem, CmsDataset, LoadedContent } from '../../../types';
import { PUBLICATION_STATE_LABELS, createDraft, parseTerms } from '../../../lib/drafts.js';
import { slugify } from '../../../lib/slug.js';
import { sourceFingerprint } from '../../../lib/overlay.js';
import { sha256Hex } from '../../../lib/qortal.js';
import { stripHtml } from '../../../lib/text.js';

export type QdnRefLike = { service: string; name?: string; identifier: string };

export function termNames(dataset: CmsDataset | null, ids: string[] | undefined, kind: 'categories' | 'tags') {
  if (!dataset) return '';
  const terms = kind === 'categories' ? dataset.categories : dataset.tags;
  return (ids || [])
    .map((id) => {
      const term = terms.find((entry) => entry.id === id);
      return term ? term.name : id;
    })
    .join(', ');
}

export function resolveTerms(dataset: CmsDataset | null, text: string, kind: 'categories' | 'tags') {
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

export function draftFromItem(item: CmsContentItem, content: LoadedContent, revision: number, dataset: CmsDataset | null) {
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

export async function fingerprintSource(content: LoadedContent, item: CmsContentItem) {
  const text = sourceFingerprint({
    title: content.title,
    html: content.html,
    excerpt: stripHtml(content.excerptHtml),
    modifiedAt: content.modifiedAt,
    sourceId: item.legacy ? item.legacy.sourceId : null
  });
  return 'sha256:' + await sha256Hex(new TextEncoder().encode(text));
}

export function publicationLabel(state: string) {
  return (PUBLICATION_STATE_LABELS as Record<string, string>)[state] || state;
}

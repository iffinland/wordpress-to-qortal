import { describe, expect, it } from 'vitest';
import {
  emptyGalleryCatalog,
  findGallery,
  galleryCounts,
  gallerySlug,
  imageIdentifier,
  MAX_BATCH_IMAGES,
  readGalleryCatalog,
  removeGallery,
  upsertGallery,
  validateGalleryDraft
} from '../src/lib/gallery.js';

const identity = { address: 'QOwnerAddress111111111111111111111', qdnName: 'developer iffi' };

function image(identifier: string) {
  return { service: 'IMAGE', name: 'developer iffi', identifier, caption: 'Caption', alt: 'Alt' };
}

describe('gallery catalog', () => {
  it('enforces the 10-image batch limit and required fields', () => {
    expect(MAX_BATCH_IMAGES).toBe(10);
    const ok = { title: 'Trip', description: '', images: [image('a')] };
    expect(validateGalleryDraft(ok, { newImages: new Array(10).fill({}) }).ok).toBe(true);
    expect(validateGalleryDraft(ok, { newImages: new Array(11).fill({}) }).ok).toBe(false);
    expect(validateGalleryDraft({ ...ok, title: '' }).ok).toBe(false);
    expect(validateGalleryDraft({ ...ok, images: [] }).ok).toBe(false);
  });

  it('creates unique slugs and content-addressed image identifiers', () => {
    expect(gallerySlug('My Gallery', [])).toBe('my-gallery');
    expect(gallerySlug('My Gallery', [{ slug: 'my-gallery' }])).toBe('my-gallery-2');
    const id = imageIdentifier('sha256:' + 'a'.repeat(64));
    expect(id).toBe('qms-cms-img-' + 'a'.repeat(32));
    expect(() => imageIdentifier('nope')).toThrow();
  });

  it('adds galleries with revision checks and counts images', () => {
    const catalog = emptyGalleryCatalog('site');
    const gallery = { id: 'g1', slug: 'g1', title: 'G1', description: '', images: [image('a'), image('b')] };
    const result = upsertGallery(catalog, gallery, { baseRevision: 0, identity });
    expect(result.ok).toBe(true);
    expect(result.catalog.revision).toBe(1);
    expect(galleryCounts(result.catalog)).toEqual({ galleries: 1, images: 2 });
    expect(findGallery(result.catalog, 'g1')?.title).toBe('G1');
    const stale = upsertGallery(result.catalog, gallery, { baseRevision: 0, identity });
    expect(stale.ok).toBe(false);
    expect(stale.conflict).toBe(true);
  });

  it('removes a gallery only at the current revision', () => {
    const catalog = upsertGallery(emptyGalleryCatalog('site'), { id: 'g1', slug: 'g1', title: 'G1', description: '', images: [image('a')] }, { baseRevision: 0, identity }).catalog;
    expect(removeGallery(catalog, 'g1', { baseRevision: 0, identity }).ok).toBe(false);
    const removed = removeGallery(catalog, 'g1', { baseRevision: 1, identity });
    expect(removed.ok).toBe(true);
    expect(removed.catalog.galleries).toHaveLength(0);
  });

  it('rejects unsupported gallery schemas', () => {
    expect(readGalleryCatalog(emptyGalleryCatalog()).ok).toBe(true);
    expect(readGalleryCatalog({ schema: 'other@1', galleries: [] }).ok).toBe(false);
    expect(readGalleryCatalog({ schema: 'qms-cms-gallery@1', version: 99, galleries: [] }).ok).toBe(false);
  });
});


/**
 * Versioned native gallery catalog.
 *
 * Resource: DOCUMENT / <name> / qms-cms-galleries
 * Schema:   qms-cms-gallery@1
 *
 * Images are ordinary QDN IMAGE/VIDEO/FILE resources. Publishing adds refs to
 * this document; it never overwrites imported content or existing galleries
 * without an explicit revision check.
 */

import { slugify } from './text.js';

export const GALLERY_CATALOG_SCHEMA = 'qms-cms-gallery@1';
export const GALLERY_CATALOG_VERSION = 1;
export const GALLERY_CATALOG_IDENTIFIER = 'qms-cms-galleries';
export const MAX_BATCH_IMAGES = 10;
export const MAX_IMAGE_BYTES = 200 * 1024 * 1024;

export function emptyGalleryCatalog(siteId = 'site') {
  return {
    schema: GALLERY_CATALOG_SCHEMA,
    version: GALLERY_CATALOG_VERSION,
    revision: 0,
    site_id: String(siteId || 'site'),
    updated_at: null,
    published_by: null,
    galleries: []
  };
}

export function readGalleryCatalog(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['Gallery catalog is not an object.'], catalog: null };
  if (payload.schema !== GALLERY_CATALOG_SCHEMA) return { ok: false, errors: ['Unsupported gallery schema.'], catalog: null };
  if (Number(payload.version) > GALLERY_CATALOG_VERSION) return { ok: false, errors: ['Gallery catalog version is newer than this template.'], catalog: null };
  if (!Array.isArray(payload.galleries)) return { ok: false, errors: ['Gallery list must be an array.'], catalog: null };
  return { ok: true, errors: [], catalog: payload };
}

export function gallerySlug(title, existing = []) {
  const base = slugify(title || 'gallery') || 'gallery';
  let slug = base;
  let index = 2;
  const taken = new Set(existing.map((item) => item.slug));
  while (taken.has(slug)) {
    slug = base + '-' + index;
    index += 1;
  }
  return slug;
}

export function validateGalleryDraft(draft, options = {}) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['Gallery draft must be an object.'] };
  if (!String(draft.title || '').trim()) errors.push('Gallery title is required.');
  if (String(draft.title || '').length > 120) errors.push('Gallery title must be 120 characters or fewer.');
  if (String(draft.description || '').length > 600) errors.push('Gallery description must be 600 characters or fewer.');
  if (!Array.isArray(draft.images) || draft.images.length === 0) errors.push('Add at least one image.');
  const batch = Array.isArray(options.newImages) ? options.newImages.length : (draft.images || []).length;
  if (batch > MAX_BATCH_IMAGES) errors.push('A batch can publish at most ' + MAX_BATCH_IMAGES + ' images. Publish this batch, then add the next.');
  if (Array.isArray(draft.images)) {
    draft.images.forEach((image, index) => {
      const hasRef = image && ((image.qdn && image.qdn.identifier) || (image.service && image.identifier));
      if (!hasRef) errors.push('Image ' + (index + 1) + ' has no QDN reference.');
      if (image && String(image.caption || '').length > 300) errors.push('Image ' + (index + 1) + ' caption is too long.');
    });
  }
  return { ok: errors.length === 0, errors };
}

export function imageIdentifier(hash) {
  const clean = String(hash || '').replace(/^sha256:/, '').toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(clean)) throw new Error('An exact SHA-256 hash is required for a stable media identifier.');
  return ('qms-cms-img-' + clean.slice(0, 32)).slice(0, 64);
}

export function galleryImageFromMedia({ qdn, mimeType, bytes, sha256, caption, alt, width, height }) {
  return {
    service: qdn.service,
    name: qdn.name,
    identifier: qdn.identifier,
    mimeType: mimeType || null,
    bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : null,
    sha256: sha256 || null,
    caption: String(caption || ''),
    alt: String(alt || ''),
    width: Number.isFinite(Number(width)) ? Number(width) : null,
    height: Number.isFinite(Number(height)) ? Number(height) : null
  };
}

export function upsertGallery(catalog, gallery, options = {}) {
  const current = catalog && catalog.schema === GALLERY_CATALOG_SCHEMA ? catalog : emptyGalleryCatalog(options.siteId);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return {
      ok: false,
      conflict: true,
      message: 'Published galleries moved from revision ' + baseRevision + ' to ' + remoteRevision + '. Reload before publishing so no gallery is overwritten.',
      catalog: current
    };
  }
  const galleries = Array.isArray(current.galleries) ? [...current.galleries] : [];
  const index = galleries.findIndex((item) => item.id === gallery.id);
  if (index >= 0) galleries[index] = gallery;
  else galleries.push(gallery);
  return {
    ok: true,
    conflict: false,
    message: '',
    catalog: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      published_by: options.identity ? { address: options.identity.address, name: options.identity.qdnName } : current.published_by,
      galleries
    }
  };
}

export function removeGallery(catalog, id, options = {}) {
  const current = catalog && catalog.schema === GALLERY_CATALOG_SCHEMA ? catalog : emptyGalleryCatalog(options.siteId);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return { ok: false, conflict: true, message: 'Published galleries changed on another device. Reload before deleting.', catalog: current };
  }
  return {
    ok: true,
    conflict: false,
    message: '',
    catalog: {
      ...current,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      galleries: (current.galleries || []).filter((item) => item.id !== id)
    }
  };
}

export function galleryCounts(catalog) {
  const galleries = catalog && Array.isArray(catalog.galleries) ? catalog.galleries : [];
  return {
    galleries: galleries.length,
    images: galleries.reduce((sum, gallery) => sum + (Array.isArray(gallery.images) ? gallery.images.length : 0), 0)
  };
}

export function findGallery(catalog, slug) {
  if (!catalog || !Array.isArray(catalog.galleries)) return null;
  return catalog.galleries.find((gallery) => gallery.slug === slug || gallery.id === slug) || null;
}


import { describe, expect, it } from 'vitest';
import {
  FEATURED_IMAGE_HELP,
  autoFeaturedImage,
  featuredImageEntryFields,
  isUnsuitableImage,
  normalizeFeaturedImage,
  parseImageReference,
  resolveFeaturedImage,
  resolveImageReference
} from '../src/lib/featuredImage.js';
import { buildNativeContentPayload, nativeEntryFromDraft } from '../src/lib/nativeCatalog.js';
import { createOverlayEntry, mergeOverlayCatalog } from '../src/lib/overlay.js';

const HERO = { service: 'IMAGE', name: 'QortalDemo', identifier: 'qms-cms-media-hero' };
const qdnUrl = (identifier: string) => '/arbitrary/IMAGE/QortalDemo/' + identifier;

function dataset(overrides: any = {}) {
  return {
    site: { id: 'site-fixture', title: 'Site', ownerName: 'QortalDemo' },
    media: [],
    urls: { bySourceUrl: {} },
    ...overrides
  };
}

describe('featured image wording and references', () => {
  it('uses the exact optional-featured-image explanation', () => {
    expect(FEATURED_IMAGE_HELP).toBe(
      'Featured image is optional. If you don’t choose one, the first suitable image in your post will be used automatically. If your post has no images, it will be published without a featured image.'
    );
  });

  it('normalizes QDN references and parses arbitrary and qortal URLs', () => {
    expect(normalizeFeaturedImage(HERO)).toMatchObject({ service: 'IMAGE', name: 'QortalDemo', identifier: 'qms-cms-media-hero' });
    expect(parseImageReference(qdnUrl('img-1'))).toMatchObject({ service: 'IMAGE', name: 'QortalDemo', identifier: 'img-1' });
    expect(parseImageReference('qortal://IMAGE/QortalDemo/img-2')).toMatchObject({ service: 'IMAGE', name: 'QortalDemo', identifier: 'img-2' });
  });

  it('resolves imported media through the catalog URL map', () => {
    const ref = resolveImageReference('https://old.example/wp-content/uploads/hero.jpg', dataset({
      media: [{ url: 'https://old.example/wp-content/uploads/hero.jpg', qdn: HERO, alt: 'Hero' }]
    }));
    expect(ref).toMatchObject({ service: 'IMAGE', name: 'QortalDemo', identifier: 'qms-cms-media-hero' });
  });
});

describe('automatic first suitable body image', () => {
  it('skips tracking pixels, icons, SVG placeholders, video thumbnails and broken refs', () => {
    const html = [
      '<p><img src="/pixel.gif" width="1" height="1"></p>',
      '<p><img src="/assets/icon-search.svg" width="24" height="24"></p>',
      '<p><img src="/spacer.png"></p>',
      '<p><img src="/thumb-video.mp4"></p>',
      '<p><img src="data:image/png;base64,AAAA"></p>',
      '<p><img src="/uploads/missing-relative.jpg"></p>',
      '<p><img src="' + qdnUrl('real-hero') + '" alt="Real hero"></p>'
    ].join('');
    const selected = autoFeaturedImage(html, dataset(), { name: 'QortalDemo', createUrl: (s: string, n: string, i: string) => '/arbitrary/' + s + '/' + n + '/' + i });
    expect(selected).toMatchObject({ ref: { service: 'IMAGE', identifier: 'real-hero' }, source: 'body' });
    expect(selected?.url).toBe(qdnUrl('real-hero'));
    expect(selected?.alt).toBe('Real hero');
  });

  it('is deterministic for the same body', () => {
    const html = '<img src="' + qdnUrl('first') + '"><img src="' + qdnUrl('second') + '">';
    const a = autoFeaturedImage(html, dataset());
    const b = autoFeaturedImage(html, dataset());
    expect(a).toEqual(b);
    expect(a?.ref?.identifier).toBe('first');
  });

  it('keeps an external body image as a URL fallback', () => {
    const selected = autoFeaturedImage('<img src="https://cdn.example/photo.jpg" width="800" height="600">', dataset());
    expect(selected).toMatchObject({ url: 'https://cdn.example/photo.jpg', source: 'body' });
    expect(selected?.ref).toBeNull();
  });

  it('returns none when the body has no suitable image', () => {
    expect(autoFeaturedImage('<p>No image here</p>', dataset())).toBeNull();
  });

  it('rejects known tracking and icon sources directly', () => {
    expect(isUnsuitableImage({ src: '/tracking/pixel.gif', width: 1, height: 1 })).toBe(true);
    expect(isUnsuitableImage({ src: '/images/icon-menu.png' })).toBe(true);
    expect(isUnsuitableImage({ src: '/images/hero.jpg', width: 800, height: 600 })).toBe(false);
  });
});

describe('resolution order', () => {
  const body = '<p><img src="' + qdnUrl('body-image') + '"></p>';

  it('prefers an explicit selection over the body', () => {
    const view = resolveFeaturedImage({
      html: body,
      featuredImage: HERO,
      featuredImageOrigin: 'explicit',
      featuredImageManual: true
    }, dataset());
    expect(view.ref?.identifier).toBe('qms-cms-media-hero');
    expect(view.source).toBe('explicit');
  });

  it('preserves a WordPress featured image unless the owner changes it', () => {
    const view = resolveFeaturedImage({
      html: body,
      featuredImage: HERO,
      featuredImageOrigin: 'wordpress'
    }, dataset());
    expect(view.ref?.identifier).toBe('qms-cms-media-hero');
    expect(view.source).toBe('wordpress');
  });

  it('falls back to the first body image when nothing was chosen', () => {
    const view = resolveFeaturedImage({ html: body }, dataset());
    expect(view.ref?.identifier).toBe('body-image');
    expect(view.source).toBe('body');
  });

  it('recomputes an automatic image from the current body', () => {
    const view = resolveFeaturedImage({
      html: body,
      featuredImage: HERO,
      featuredImageOrigin: 'body'
    }, dataset());
    expect(view.ref?.identifier).toBe('body-image');
    expect(view.source).toBe('body');
  });

  it('honours an explicit no-image decision', () => {
    const view = resolveFeaturedImage({ html: body, featuredImageSuppressed: true }, dataset());
    expect(view.ref).toBeNull();
    expect(view.url).toBe('');
    expect(view.source).toBe('none');
  });
});

describe('published featured metadata', () => {
  const resolved = {
    ref: HERO,
    url: qdnUrl('qms-cms-media-hero'),
    alt: 'Hero',
    source: 'explicit'
  };
  const mediaDocument = {
    featured: { ...HERO, role: 'featured', alt: 'Hero' },
    images: [],
    audio: [],
    video: [],
    documents: [],
    embeds: [],
    attachments: []
  };

  it('persists featured image fields in the native index entry', () => {
    const built = nativeEntryFromDraft({
      id: 'cms-1', type: 'post', title: 'T', slug: 't', status: 'published',
      featuredImageResolved: resolved
    }, { siteId: 'site', qdnName: 'QortalDemo', contentIdentifier: 'content-1', contentHash: 'sha256:x' });
    expect(built.entry.featured_image).toMatchObject({ service: 'IMAGE', identifier: 'qms-cms-media-hero' });
    expect(built.entry.featured_image_source).toBe('explicit');
  });

  it('persists featured image in the qms-qdn-content@1 media document', () => {
    const payload = buildNativeContentPayload({
      title: 'T', slug: 't', html: '<p>Body</p>', type: 'post',
      featuredImageResolved: resolved, mediaDocument
    }, { contentIdentifier: 'content-1', qdnName: 'QortalDemo', contentHash: 'sha256:x' });
    expect(payload.media.featured).toMatchObject({ service: 'IMAGE', identifier: 'qms-cms-media-hero', role: 'featured' });
    expect(payload.media.images).toEqual([]);
  });

  it('persists featured image in an overlay entry and applies it to the catalog', () => {
    const entry = createOverlayEntry({
      item: { id: 'wp-1', type: 'post', slug: 'imported', title: 'Imported', categoryIds: [], tagIds: [] },
      content: { title: 'Edited', html: '<p>x</p>', excerpt: '', modifiedAt: null },
      draft: { slug: 'imported', title: 'Edited', excerpt: '', categoryIds: [], tagIds: [] },
      contentRef: { service: 'DOCUMENT', name: 'QortalDemo', identifier: 'overlay-1' },
      contentHash: 'sha256:x',
      featuredImage: resolved,
      baseSourceHash: 'sha256:source',
      identity: { address: 'QOwner', qdnName: 'QortalDemo' }
    });
    expect(entry.featured_image).toMatchObject({ identifier: 'qms-cms-media-hero' });
    expect(entry.featured_image_source).toBe('explicit');
    const merged = mergeOverlayCatalog({
      posts: [{ id: 'wp-1', type: 'post', slug: 'imported', title: 'Imported', excerpt: '', categoryIds: [], tagIds: [], contentRef: { service: 'DOCUMENT', identifier: 'orig' }, featuredImageRef: null }],
      pages: [], categories: [], tags: [], notices: []
    } as any, { schema: 'qms-cms-overlay@1', version: 1, revision: 1, entries: [entry] } as any);
    expect(merged.posts[0].featuredImageRef).toMatchObject({ identifier: 'qms-cms-media-hero' });
    expect(merged.posts[0].featuredImageSource).toBe('explicit');
  });

  it('omits featured fields for an empty-image post', () => {
    const fields = featuredImageEntryFields({ ref: null, url: '', alt: '', source: 'none' });
    expect(fields).toEqual({ featured_image: null, featured_image_url: null, featured_image_alt: null, featured_image_source: null });
  });
});

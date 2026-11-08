import test from 'node:test';
import assert from 'node:assert/strict';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';

/**
 * Reproduces the owner's attachment-heavy WordPress site: a gallery plugin
 * attaches hundreds of media-library items to one post, while the rendered
 * article only displays three images. Before the dependency policy fix, every
 * attachment became a required media resource (567 files in the reported
 * 5-post plan), tripping DISK_LIMIT_EXCEEDED at maxFilesPerRun=500.
 */
function attachmentHeavyData({ attachmentCount = 600, posts = 5 } = {}) {
  const postItems = [];
  for (let index = 0; index < posts; index += 1) {
    postItems.push(makePost(index, {
      id: 1000 + index,
      slug: 'gallery-post-' + index,
      title: 'Gallery post ' + index,
      content: index === 0
        ? '<p>Gallery</p><img src="/wp-content/uploads/gallery-one.jpg"><img src="/wp-content/uploads/gallery-two.jpg"><img src="/wp-content/uploads/gallery-three.jpg">'
        : '<p>Text post ' + index + '</p>',
      featured_media: 0
    }));
  }

  const media = [
    { id: 9001, slug: 'gallery-one', title: 'Gallery one', source_url: '/wp-content/uploads/gallery-one.jpg', media_type: 'image', mime_type: 'image/jpeg', post: 1000 },
    { id: 9002, slug: 'gallery-two', title: 'Gallery two', source_url: '/wp-content/uploads/gallery-two.jpg', media_type: 'image', mime_type: 'image/jpeg', post: 1000 },
    { id: 9003, slug: 'gallery-three', title: 'Gallery three', source_url: '/wp-content/uploads/gallery-three.jpg', media_type: 'image', mime_type: 'image/jpeg', post: 1000 }
  ];
  for (let index = 0; index < attachmentCount; index += 1) {
    media.push({
      id: 10000 + index,
      slug: 'library-' + index,
      title: 'Unused library image ' + index,
      source_url: '/wp-content/uploads/library-' + index + '.jpg',
      media_type: 'image',
      mime_type: 'image/jpeg',
      post: 1000
    });
  }

  const data = {
    site: { name: 'Attachment Heavy', description: 'Fixture', namespaces: ['wp/v2'] },
    posts: postItems,
    pages: [],
    categories: [],
    tags: [],
    media,
    customTypes: {},
    books: []
  };
  return data;
}

test('AUDIT-001: unreferenced attachment flood does not become required media', async (t) => {
  const env = await startPhase3(t, { data: attachmentHeavyData({ attachmentCount: 600, posts: 5 }) });
  const discovered = await env.handle.source.discover({ perPage: 100, progressEvery: 100 });
  assert.equal(discovered.status, 'completed');

  const plan = await env.handle.planning.create({
    batchSize: 5,
    estimateMedia: false,
    persist: false,
    // Deterministic fixture: sizes are unknown without hitting a media server,
    // so account each at a small estimate. The file cap still applies.
    disk: { unknownSizePolicy: 'estimate', unknownSizeBytes: 4096, maxFilesPerRun: 500 }
  });
  assert.equal(plan.status, 'completed', 'the plan must not be blocked by an unreferenced media library');
  // Required media: the three images the article actually displays.
  const urls = plan.plan.media.map((entry) => entry.url);
  assert.equal(urls.length, 3, 'only referenced attachments are required');
  for (const expected of ['gallery-one.jpg', 'gallery-two.jpg', 'gallery-three.jpg']) {
    assert.ok(urls.some((url) => url.endsWith(expected)), 'required media is preserved: ' + expected);
  }
  assert.equal(plan.plan.mediaSummary.unreferencedAttachmentsSkipped, 600);
  assert.ok(plan.plan.warnings.some((warning) => warning.code === 'MEDIA_UNREFERENCED_ATTACHMENTS_SKIPPED'));
  assert.equal(plan.plan.disk.fits, true);
});

test('AUDIT-001: the previous 600-attachment flood still reproduces the file-cap failure when explicitly opted in', async (t) => {
  const env = await startPhase3(t, { data: attachmentHeavyData({ attachmentCount: 600, posts: 5 }) });
  await env.handle.source.discover({ perPage: 100, progressEvery: 100 });
  const plan = await env.handle.planning.create({
    batchSize: 5,
    estimateMedia: false,
    persist: false,
    disk: { unknownSizePolicy: 'estimate', unknownSizeBytes: 4096, maxFilesPerRun: 500 },
    media: { includeUnreferencedAttachments: true }
  });
  assert.equal(plan.plan.mediaSummary.count > 500, true);
  assert.ok(plan.plan.mediaSummary.count >= 601, 'opt-in mode collects the whole media library');
  assert.equal(plan.status, 'blocked');
  assert.ok(
    plan.plan.errors.some((error) => error.code === 'DISK_LIMIT_EXCEEDED'),
    'opt-in collection is still gated by the real file cap'
  );
});

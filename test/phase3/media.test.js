import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import {
  assetPathFor,
  hashFile,
  partPathFor,
  verifyAsset,
  validateMediaUrl
} from '../../lib/engine/index.js';
import { makePost, dataWithPosts, startPhase3 } from '../../test-support/phase3/helpers.js';

function mediaPost(mediaUrl, index, url, body = 'Media body') {
  return makePost(index, { content: '<p>' + body + ' ' + index + '</p><img src="' + url + '">' });
}

function imageUrl(mediaUrl, pathName, bytes = 2048, extra = '') {
  return mediaUrl + pathName + '?bytes=' + bytes + extra;
}

async function prepare(t, { urlFactory, settings = {}, mediaOptions = {} }) {
  const env = await startPhase3(t, {
    mediaServer: true,
    mediaOptions,
    dataFactory: ({ mediaUrl }) => dataWithPosts(urlFactory(mediaUrl)),
    settings: { ...settings, media: { allowExternalMedia: true, ...(settings.media ?? {}) } }
  });
  await env.handle.source.discover({ perPage: 50 });
  return env;
}

test('media downloads are streamed, hashed, content-addressed and receipted', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [
      mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/known/alpha.jpg', 2048)),
      mediaPost(mediaUrl, 1, imageUrl(mediaUrl, '/media/known/beta.png', 3072)),
      mediaPost(mediaUrl, 2, imageUrl(mediaUrl, '/media/known/gamma.pdf', 4096))
    ]
  });
  const plan = await env.handle.planning.create({ batchSize: 3 });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.media.knownCount, 3);
  assert.equal(plan.media.knownBytes, 9216);
  const download = await env.handle.media.download({ planId: plan.planId, concurrency: 2 });
  assert.equal(download.status, 'completed');
  assert.equal(download.counts.verified, 3);
  assert.equal(download.bytes, 9216);

  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 3);
  assert.equal(inspection.totals.bytes, 9216);
  assert.equal(inspection.parts.count, 0);
  for (const asset of inspection.assets) {
    assert.match(asset.hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(asset.refCount, 1);
    const filePath = assetPathFor(env.handle.paths.mediaAssetsDir, asset.hash);
    const computed = await hashFile(filePath);
    assert.equal(computed.hash, asset.hash);
    assert.equal(computed.bytes, asset.bytes);
  }
  const entries = await readdir(env.handle.paths.mediaAssetsDir, { recursive: true });
  assert.equal(entries.filter((name) => name.endsWith('.part')).length, 0);
});

test('shared media urls are downloaded once and reference counted across items', async (t) => {
  const url = (mediaUrl) => imageUrl(mediaUrl, '/media/known/alpha.jpg', 4096);
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [
      mediaPost(mediaUrl, 0, url(mediaUrl), 'First shared'),
      mediaPost(mediaUrl, 1, url(mediaUrl), 'Second shared')
    ]
  });
  const plan = await env.handle.planning.create({ batchSize: 2 });
  assert.equal(plan.media.count, 1);
  const getBefore = env.media.requests.filter((request) => request.method === 'GET').length;
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.equal(download.status, 'completed');
  assert.equal(download.counts.verified, 1);
  assert.equal(env.media.requests.filter((request) => request.method === 'GET').length - getBefore, 1);
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 1);
  assert.equal(inspection.assets[0].refCount, 2);
  assert.equal(Object.keys(env.handle.store.state.media.itemRefs).length, 2);
});

test('different urls with identical bytes deduplicate to one stored asset', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [
      mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/shared-a', 2048), 'A'),
      mediaPost(mediaUrl, 1, imageUrl(mediaUrl, '/media/shared-b', 2048), 'B')
    ]
  });
  const plan = await env.handle.planning.create({ batchSize: 2 });
  assert.equal(plan.media.count, 2);
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.equal(download.status, 'completed');
  assert.equal(download.counts.verified, 2);
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 1);
  assert.equal(inspection.assets[0].refCount, 2);
  assert.equal(inspection.assets[0].sourceCount, 2);
});

test('unknown-size media can be downloaded under the capped policy and is never treated as zero', async (t) => {
  const env = await prepare(t, {
    settings: { disk: { unknownSizePolicy: 'cap', maxFileBytes: 4096, maxBytesPerRun: 0 } },
    urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, mediaUrl + '/media/unknown?bytes=1500')]
  });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  assert.equal(plan.media.unknownCount, 1);
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.equal(download.status, 'completed');
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 1);
  assert.equal(inspection.assets[0].bytes, 1500);
});

test('verified media is reused on a second download without another GET', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/known/alpha.jpg', 1024))]
  });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const first = await env.handle.media.download({ planId: plan.planId });
  assert.equal(first.status, 'completed');
  const getsAfterFirst = env.media.requests.filter((request) => request.method === 'GET').length;
  const second = await env.handle.media.download({ planId: plan.planId });
  assert.equal(second.status, 'completed');
  assert.equal(second.counts.reused, 1);
  assert.equal(env.media.requests.filter((request) => request.method === 'GET').length, getsAfterFirst);
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 1);
});

test('missing, blocked and external media are explicit, never silently downloaded', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [
      mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/missing', 512), 'missing'),
      mediaPost(mediaUrl, 1, imageUrl(mediaUrl, '/media/html', 512), 'html'),
      mediaPost(mediaUrl, 2, 'file:///etc/passwd', 'local')
    ]
  });
  const plan = await env.handle.planning.create({ batchSize: 3 });
  assert.equal(plan.status, 'completed');
  const missing = plan.plan.media.find((entry) => entry.url.includes('/media/missing'));
  const html = plan.plan.media.find((entry) => entry.url.includes('/media/missing') === false && entry.url.includes('127.0.0.1'));
  assert.equal(missing.status, 'missing');
  assert.ok(missing.code === 'MEDIA_NOT_FOUND');
  assert.ok(plan.plan.media.some((entry) => entry.status === 'blocked' || entry.status === 'skipped_external'));
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.ok(['completed', 'partial'].includes(download.status));
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 0);
  assert.ok(inspection.downloads.missing >= 1);
  void html;
});

test('external media is linked-only by default and downloadable only when explicitly enabled', async (t) => {
  const config = {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/known/alpha.jpg', 1024), 'external')
    ])
  };
  const envOff = await startPhase3(t, {
    ...config,
    settings: { media: { allowExternalMedia: false } }
  });
  await envOff.handle.source.discover({ perPage: 50 });
  const linkedOnly = await envOff.handle.planning.create({ batchSize: 1 });
  assert.equal(linkedOnly.status, 'completed');
  assert.equal(linkedOnly.media.skippedExternal, 1);
  const skipped = await envOff.handle.media.download({ planId: linkedOnly.planId });
  assert.equal(skipped.status, 'completed');
  assert.equal(skipped.counts.skipped, 1);
  assert.equal((await envOff.handle.media.inspect()).totals.assets, 0);

  const envOn = await startPhase3(t, {
    ...config,
    settings: { media: { allowExternalMedia: true } }
  });
  await envOn.handle.source.discover({ perPage: 50 });
  const allowed = await envOn.handle.planning.create({ batchSize: 1 });
  assert.equal(allowed.status, 'completed');
  assert.equal(allowed.media.knownCount, 1);
  const downloaded = await envOn.handle.media.download({ planId: allowed.planId });
  assert.equal(downloaded.status, 'completed');
  assert.equal((await envOn.handle.media.inspect()).totals.assets, 1);
});

test('redirects are validated one at a time and unsafe targets are refused', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [
      mediaPost(mediaUrl, 0, mediaUrl + '/media/redirect?bytes=1024', 'safe redirect'),
      mediaPost(mediaUrl, 1, mediaUrl + '/media/redirect-file', 'unsafe redirect')
    ]
  });
  const plan = await env.handle.planning.create({ batchSize: 2 });
  assert.equal(plan.status, 'completed');
  const safe = plan.plan.media.find((entry) => entry.url.includes('/media/redirect?'));
  const unsafe = plan.plan.media.find((entry) => entry.url.includes('/media/redirect-file'));
  assert.equal(safe.status, 'known');
  assert.equal(unsafe.status, 'blocked');
  const download = await env.handle.media.download({ planId: plan.planId });
  assert.ok(['completed', 'partial'].includes(download.status));
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 1);
});

test('media URL and path policy rejects local schemes, private addresses and unsafe symlinks', async (t) => {
  assert.equal((await validateMediaUrl('file:///etc/passwd')).ok, false);
  assert.equal((await validateMediaUrl('http://user:password@example.test/x', { resolveDns: false })).ok, false);
  assert.equal((await validateMediaUrl('http://127.0.0.1/x', { resolveDns: false, allowLoopback: false })).ok, false);
  assert.equal((await validateMediaUrl('http://10.0.0.1/x', { resolveDns: false })).ok, false);
  assert.equal((await validateMediaUrl('http://169.254.169.254/latest/meta-data', { resolveDns: false })).ok, false);
  assert.equal((await validateMediaUrl('http://127.0.0.1/x', { resolveDns: false, allowLoopback: true })).ok, true);

  const env = await prepare(t, { urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/known/alpha.jpg', 128))] });
  const part = partPathFor(env.handle.paths.mediaTmpDir, 'http://127.0.0.1/../../etc/passwd');
  assert.ok(part.startsWith(env.handle.paths.mediaTmpDir));
  assert.equal(path.basename(part).includes('..'), false);

  const hash = 'sha256:' + 'a'.repeat(64);
  const target = assetPathFor(env.handle.paths.mediaAssetsDir, hash);
  await mkdir(path.dirname(target), { recursive: true });
  await symlink('/etc/passwd', target);
  await assert.rejects(
    () => verifyAsset({ filePath: target, hash }),
    (error) => error.code === 'MEDIA_UNSAFE_PATH'
  );
});

test('an interrupted download leaves a .part file and resumes with a validated Range request', async (t) => {
  const env = await prepare(t, {
    settings: { media: { maxRetries: 0 } },
    urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/interrupt', 8192))]
  });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const first = await env.handle.media.download({ planId: plan.planId });
  assert.equal(first.status, 'partial');
  assert.equal(first.counts.failed, 1);
  const afterFirst = await env.handle.media.inspect();
  assert.equal(afterFirst.totals.assets, 0);
  assert.ok(afterFirst.parts.count >= 1);
  const partBytes = afterFirst.parts.bytes;
  assert.ok(partBytes > 0);
  const second = await env.handle.media.download({ planId: plan.planId });
  assert.equal(second.status, 'completed');
  const getRequests = env.media.requests.filter((request) => request.method === 'GET');
  assert.ok(getRequests.some((request) => request.range && request.range.startsWith('bytes=')), JSON.stringify(getRequests));
  const afterSecond = await env.handle.media.inspect();
  assert.equal(afterSecond.totals.assets, 1);
  assert.equal(afterSecond.parts.count, 0);
});

test('cancellation keeps partial state and never finalizes an unverified file', async (t) => {
  const env = await prepare(t, {
    mediaOptions: { chunkSize: 4096, chunkDelayMs: 15 },
    settings: { media: { maxRetries: 0 } },
    urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/slow', 1024 * 1024))]
  });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  const controller = new AbortController();
  const download = env.handle.media.download({ planId: plan.planId, signal: controller.signal });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (env.media.requests.some((request) => request.method === 'GET')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  const result = await download;
  assert.equal(result.status, 'cancelled');
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 0);
});

test('a blocked plan cannot be downloaded', async (t) => {
  const env = await prepare(t, {
    urlFactory: (mediaUrl) => [mediaPost(mediaUrl, 0, imageUrl(mediaUrl, '/media/known/alpha.jpg', 4096))]
  });
  const plan = await env.handle.planning.create({
    batchSize: 1,
    disk: { maxFileBytes: 1024, maxBytesPerRun: 0 }
  });
  assert.equal(plan.status, 'blocked');
  await assert.rejects(
    () => env.handle.media.download({ planId: plan.planId }),
    (error) => error.code === 'PLAN_BLOCKED'
  );
});

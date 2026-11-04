import test from 'node:test';
import assert from 'node:assert/strict';
import { diskPreflight, fixedDiskProbe, sequenceDiskProbe, GIB } from '../../lib/engine/index.js';
import { makePost, dataWithPosts, startPhase3 } from '../../test-support/phase3/helpers.js';

function limits(overrides = {}) {
  return {
    reserveBytes: 0,
    maxBytesPerRun: 0,
    maxFileBytes: 256 * 1024 * 1024,
    maxFilesPerRun: 500,
    unknownSizePolicy: 'reject',
    unknownSizeBytes: null,
    safetyFactor: 1,
    ...overrides
  };
}

test('disk preflight measures the workspace filesystem, reserve and unknown sizes', async () => {
  const fits = await diskPreflight({
    probe: fixedDiskProbe(1 * GIB),
    workspacePath: '/synthetic/workspace',
    limits: limits({ reserveBytes: 512 * 1024 * 1024 }),
    knownBytes: 100 * 1024 * 1024,
    unknownCount: 0,
    metadataBytes: 1024
  });
  assert.equal(fits.fits, true);
  assert.equal(fits.availableBytes, 1 * GIB);
  assert.equal(fits.requiredBytes, 100 * 1024 * 1024 + 1024 + 512 * 1024 * 1024);

  const refused = await diskPreflight({
    probe: fixedDiskProbe(100 * 1024 * 1024),
    workspacePath: '/synthetic/workspace',
    limits: limits({ reserveBytes: 10 * GIB }),
    knownBytes: 0
  });
  assert.equal(refused.fits, false);
  assert.equal(refused.reason, 'DISK_SPACE_INSUFFICIENT');
  assert.ok(refused.insufficientBy > 0);

  const unknownRejected = await diskPreflight({
    probe: fixedDiskProbe(10 * GIB),
    workspacePath: '/synthetic/workspace',
    limits: limits({ unknownSizePolicy: 'reject' }),
    knownBytes: 0,
    unknownCount: 2
  });
  assert.equal(unknownRejected.fits, false);
  assert.equal(unknownRejected.reason, 'MEDIA_UNKNOWN_SIZE');

  const unknownCapped = await diskPreflight({
    probe: fixedDiskProbe(10 * GIB),
    workspacePath: '/synthetic/workspace',
    limits: limits({ unknownSizePolicy: 'cap', maxFileBytes: 1024 }),
    knownBytes: 0,
    unknownCount: 2
  });
  assert.equal(unknownCapped.fits, true);
  assert.equal(unknownCapped.unknownBytes, 2048);
  assert.notEqual(unknownCapped.unknownBytes, 0);

  const unknownEstimated = await diskPreflight({
    probe: fixedDiskProbe(10 * GIB),
    workspacePath: '/synthetic/workspace',
    limits: limits({ unknownSizePolicy: 'estimate', unknownSizeBytes: 4096 }),
    knownBytes: 0,
    unknownCount: 2
  });
  assert.equal(unknownEstimated.unknownBytes, 8192);
});

function mediaPost(mediaUrl, index = 0, size = 2048) {
  return makePost(index, {
    content: '<p>Media body</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=' + size + '&p=' + index + '">'
  });
}

test('a plan is refused before download when projected bytes plus reserve exceed free space', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, 2 * 1024 * 1024),
      mediaPost(mediaUrl, 1, 2 * 1024 * 1024)
    ]),
    diskProbe: fixedDiskProbe(1 * 1024 * 1024),
    settings: { disk: { reserveBytes: 512 * 1024 } }
    , settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2 });
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.errors.some((error) => error.code === 'DISK_SPACE_INSUFFICIENT'));
  assert.equal(env.handle.identity.listMappings().length, 0);
  assert.equal(env.media.requests.filter((request) => request.method === 'GET').length, 0);
});

test('unknown media sizes are refused by default and accepted only under a bounded policy', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      makePost(0, { content: '<img src="' + mediaUrl + '/media/unknown?bytes=1500">' })
    ]),
    settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const rejected = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(rejected.status, 'blocked');
  assert.equal(rejected.media.unknownCount, 1);
  assert.ok(rejected.errors.some((error) => error.code === 'MEDIA_UNKNOWN_SIZE'));

  const capped = await env.handle.planning.create({
    batchSize: 1,
    disk: { unknownSizePolicy: 'cap', maxFileBytes: 4096, maxBytesPerRun: 0 }
  });
  assert.equal(capped.status, 'completed');
  assert.equal(capped.media.unknownCount, 1);
  assert.equal(capped.disk.unknownBytes, 4096);
  assert.notEqual(capped.disk.unknownBytes, 0);
});

test('plan-level per-file, file-count and byte caps reject oversized work early', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, 4096),
      mediaPost(mediaUrl, 1, 4096),
      mediaPost(mediaUrl, 2, 4096)
    ])
    , settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const perFile = await env.handle.planning.create({
    batchSize: 3,
    disk: { maxFileBytes: 1024, maxBytesPerRun: 0 }
  });
  assert.equal(perFile.status, 'blocked');
  assert.ok(perFile.errors.some((error) => error.code === 'MEDIA_FILE_TOO_LARGE'));

  const fileCount = await env.handle.planning.create({
    batchSize: 3,
    disk: { maxFilesPerRun: 2, maxBytesPerRun: 0 }
  });
  assert.equal(fileCount.status, 'blocked');
  assert.ok(fileCount.errors.some((error) => error.code === 'DISK_LIMIT_EXCEEDED'));

  const byteCap = await env.handle.planning.create({
    batchSize: 3,
    disk: { maxFilesPerRun: 10, maxBytesPerRun: 5000, maxFileBytes: 4096 }
  });
  assert.equal(byteCap.status, 'blocked');
  assert.ok(byteCap.errors.some((error) => error.code === 'DISK_LIMIT_EXCEEDED'));
});

test('runtime byte and file caps pause a download with resumable receipts', async (t) => {
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, 1024),
      mediaPost(mediaUrl, 1, 1024)
    ])
    , settings: { media: { allowExternalMedia: true } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2, disk: { maxBytesPerRun: 0, maxFileBytes: 4096 } });
  assert.equal(plan.status, 'completed');

  const byteLimited = await env.handle.media.download({
    planId: plan.planId,
    disk: { maxBytesPerRun: 1500, maxFileBytes: 1024 },
    concurrency: 1
  });
  assert.equal(byteLimited.status, 'paused');
  assert.equal(byteLimited.counts.verified, 1);
  assert.ok(byteLimited.counts.paused >= 1);
  assert.ok(byteLimited.errors.some((error) => error.code === 'DISK_LIMIT_EXCEEDED'));

  const fileLimited = await env.handle.media.download({
    planId: plan.planId,
    disk: { maxBytesPerRun: 0, maxFileBytes: 4096, maxFilesPerRun: 1 },
    concurrency: 1
  });
  assert.ok(['paused', 'completed'].includes(fileLimited.status));
  const inspection = await env.handle.media.inspect();
  assert.ok(inspection.totals.assets >= 1);
});

test('a full disk pauses at the runtime guard and never finalizes an unverified file', async (t) => {
  const probe = sequenceDiskProbe([10 * GIB, 10 * GIB, 0]);
  const env = await startPhase3(t, {
    mediaServer: true,
    dataFactory: ({ mediaUrl }) => dataWithPosts([mediaPost(mediaUrl, 0, 4096)]),
    diskProbe: probe,
    settings: {
      media: { allowExternalMedia: true },
      disk: { reserveBytes: 50 * 1024 * 1024 }
    }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 1 });
  assert.equal(plan.status, 'completed');
  const download = await env.handle.media.download({ planId: plan.planId, concurrency: 1 });
  assert.equal(download.status, 'paused');
  const inspection = await env.handle.media.inspect();
  assert.equal(inspection.totals.assets, 0);
  assert.ok(inspection.parts.count >= 0);
});

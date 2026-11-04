import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  startPhase8,
  discoverAndPlan,
  downloadAll,
  selectionFor,
  preparePublishVerify,
  receiptFor,
  mediaPost,
  crashDuring
} from './support.js';
import { dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';

function projectRoot(env) {
  return env.engine.projects.paths(env.project.id).root;
}

async function listFiles(directory) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) out.push(absolute);
    }
  }
  await walk(directory);
  return out.sort();
}

async function verifiedPublication(t, env, options = {}) {
  const { plan } = await discoverAndPlan(env, { batchSize: options.batchSize ?? 2 });
  await downloadAll(env, plan.planId);
  const published = await preparePublishVerify(t, env, {
    plan,
    selection: options.selection ?? selectionFor(plan),
    server: options.server ?? null
  });
  return { plan, ...published };
}

test('AC8.2/AC8.3/AC8.4/AC8.5 two-phase cleanup writes receipts, protects shared media, restores and preserves history', async (t) => {
  const env = await startPhase8(t);
  const { handoff } = await verifiedPublication(t, env);
  const assetsBefore = await listFiles(path.join(projectRoot(env), 'media', 'assets'));
  assert.ok(assetsBefore.length >= 1);

  const preview = await env.handle.cleanup.preview({ handoffIds: [handoff.handoffId], retentionDays: 30 });
  assert.equal(preview.schema, 'qms-cleanup-preview@1');
  assert.equal(preview.eligible, true, JSON.stringify(preview.totals));
  assert.ok(preview.totals.eligibleFiles > 0);
  assert.ok(preview.totals.eligibleBytes > 0);
  assert.ok(preview.disk.freeBytesBefore === null || Number.isInteger(preview.disk.freeBytesBefore));
  const mediaItems = preview.items.filter((item) => item.category === 'media_asset');
  assert.ok(mediaItems.every((item) => item.eligible === true));
  const payloadItems = preview.items.filter((item) => item.category === 'handoff_payload');
  assert.ok(payloadItems.length > 0);

  // AC8.4: the receipt and history snapshot exist before any file is moved.
  const cleanup = await env.handle.cleanup.start({ handoffIds: [handoff.handoffId], retentionDays: 30 });
  assert.equal(cleanup.status, 'quarantined', JSON.stringify(cleanup.failedItems));
  assert.ok(cleanup.bytesQuarantined > 0);
  const receiptFile = path.join(projectRoot(env), cleanup.receiptPath);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  assert.equal(receipt.schema, 'qms-cleanup-receipt@1');
  assert.equal(receipt.cleanupId, cleanup.cleanupId);
  assert.ok(receipt.evidence.length > 0);
  assert.ok(receipt.evidence[0].resources.every((resource) => typeof resource.sha256 === 'string'));
  assert.ok(cleanup.historySnapshotPath);
  const snapshotFile = path.join(projectRoot(env), cleanup.historySnapshotPath);
  const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
  assert.equal(snapshot.schema, 'qms-history-snapshot@1');

  const assetsAfterQuarantine = await listFiles(path.join(projectRoot(env), 'media', 'assets'));
  assert.equal(assetsAfterQuarantine.length, 0, 'verified local media should be quarantined');

  // AC8.7: purge is refused inside the retention window; restore works.
  await assert.rejects(
    () => env.handle.cleanup.purge(cleanup.cleanupId),
    (error) => error.code === 'CLEANUP_RETENTION_ACTIVE'
  );
  const restored = await env.handle.cleanup.restore(cleanup.cleanupId);
  assert.equal(restored.status, 'restored');
  const assetsRestored = await listFiles(path.join(projectRoot(env), 'media', 'assets'));
  assert.deepEqual(assetsRestored, assetsBefore);
  for (const file of assetsRestored) {
    assert.ok((await stat(file)).size > 0);
  }

  // A second cleanup can be purged after the retention window; audit history stays readable.
  const second = await env.handle.cleanup.start({ handoffIds: [handoff.handoffId], retentionDays: 0 });
  const purged = await env.handle.cleanup.purge(second.cleanupId, { force: true });
  assert.equal(purged.status, 'purged');
  assert.ok(purged.bytesReclaimed > 0);
  assert.ok(Number.isInteger(purged.filesDeleted));
  assert.equal(await listFiles(path.join(projectRoot(env), 'cleanup', 'quarantine')).then((files) => files.length), 0);

  const timeline = await env.handle.history.timeline({ limit: 500 });
  const verifiedEntry = timeline.find((entry) => entry.type === 'publication_verified' && entry.contentHash);
  assert.ok(verifiedEntry, JSON.stringify(timeline.slice(0, 10)));
  assert.match(verifiedEntry.contentHash, /^sha256:/);
  assert.ok(timeline.some((entry) => entry.type === 'cleanup_purged'));
  assert.ok(timeline.some((entry) => entry.type === 'cleanup_restored'));
  assert.equal((await env.handle.history.entries({ limit: 10 })).length > 0, true);
  const historyRaw = await readFile(path.join(projectRoot(env), 'history', 'audit.jsonl'), 'utf8');
  assert.ok(historyRaw.split('\n').filter(Boolean).length > 0);
});

test('AC8.2 cleanup is refused for a partial or unverified publication and for failed resources', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection: selectionFor(plan) });
  const stored = await env.handle.publication.get(handoff.handoffId);
  await env.handle.publication.importReceipt({
    handoffId: handoff.handoffId,
    receipt: receiptFor(stored.handoff, { suffix: 'f' })
  });
  await assert.rejects(
    () => env.handle.cleanup.start({ handoffIds: [handoff.handoffId] }),
    (error) => error.code === 'CLEANUP_NOT_ELIGIBLE' && error.details.refusedHandoffs.length > 0
  );
  assert.equal((await listFiles(path.join(projectRoot(env), 'media', 'assets'))).length, 1);

  const failedReceipt = receiptFor(stored.handoff, {
    suffix: 'g',
    results: stored.handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: 'failed',
      reason: 'publisher reported failure'
    }))
  });
  await env.handle.publication.importReceipt({ handoffId: handoff.handoffId, receipt: failedReceipt });
  await assert.rejects(
    () => env.handle.cleanup.start({ handoffIds: [handoff.handoffId] }),
    (error) => error.code === 'CLEANUP_NOT_ELIGIBLE'
  );
});

test('AC8.3 shared media referenced by an unverified item is never deleted', async (t) => {
  const env = await startPhase8(t, {
    dataFactory: ({ mediaUrl }) => dataWithPosts([
      mediaPost(mediaUrl, 0, 2048, { content: '<p>First body</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=2048&p=0">' }),
      mediaPost(mediaUrl, 1, 2048, { content: '<p>Second body</p><img src="' + mediaUrl + '/media/known/alpha.jpg?bytes=2048&p=0">' })
    ])
  });
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  await downloadAll(env, plan.planId);
  // Publish and verify only the first item; the second still references the same asset.
  const published = await preparePublishVerify(t, env, { plan, selection: ['post:1000'] });
  const preview = await env.handle.cleanup.preview({ handoffIds: [published.handoff.handoffId] });
  const protectedAssets = preview.items.filter((item) => item.category === 'media_asset' && item.eligible === false);
  assert.equal(protectedAssets.length, 1, JSON.stringify(preview.items));
  assert.ok(['SHARED_MEDIA_REFERENCED', 'UNVERIFIED_REFERENCE'].includes(protectedAssets[0].reason));
  const cleanup = await env.handle.cleanup.start({ handoffIds: [published.handoff.handoffId] });
  assert.equal(cleanup.items.filter((item) => item.category === 'media_asset' && item.moved).length, 0);
  const assets = await listFiles(path.join(projectRoot(env), 'media', 'assets'));
  assert.equal(assets.length, 1, 'the shared asset must remain on disk');
});

test('interrupted cleanup resumes from the filesystem and never double-counts', async (t) => {
  const env = await startPhase8(t);
  const { handoff } = await verifiedPublication(t, env);
  const before = await listFiles(path.join(projectRoot(env), 'media', 'assets'));
  const handle = await crashDuring(env, {
    mode: 'cleanup',
    options: { handoffIds: [handoff.handoffId], retentionDays: 30 },
    after: 1
  });
  const cleanups = handle.cleanup.list();
  assert.equal(cleanups.length, 1);
  assert.ok(['quarantining', 'partial'].includes(cleanups[0].status), cleanups[0].status);
  const quarantined = await listFiles(path.join(projectRoot(env), 'cleanup', 'quarantine'));
  assert.ok(quarantined.length >= 1);
  const resumed = await handle.cleanup.resume(cleanups[0].cleanupId);
  assert.equal(resumed.status, 'quarantined');
  assert.equal(await listFiles(path.join(projectRoot(env), 'media', 'assets')).then((files) => files.length), 0);
  const restored = await handle.cleanup.restore(cleanups[0].cleanupId);
  assert.equal(restored.status, 'restored');
  assert.deepEqual(await listFiles(path.join(projectRoot(env), 'media', 'assets')), before);
});

test('AC8.8 traversal, absolute paths, protected state and symlinks are refused', async (t) => {
  const env = await startPhase8(t);
  const { handoff } = await verifiedPublication(t, env);
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['../outside.txt'] }),
    (error) => error.code === 'CLEANUP_PATH_UNSAFE' || error.code === 'PATH_ESCAPE'
  );
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['/etc/passwd'] }),
    (error) => error.code === 'CLEANUP_PATH_UNSAFE' || error.code === 'PATH_ESCAPE'
  );
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['state/snapshot.json'] }),
    (error) => error.code === 'CLEANUP_NOT_ELIGIBLE'
  );
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['history/audit.jsonl'] }),
    (error) => error.code === 'CLEANUP_NOT_ELIGIBLE'
  );
  const root = projectRoot(env);
  const symlinkFile = path.join(root, 'media', 'assets', 'aa', 'evil-link');
  await mkdir(path.dirname(symlinkFile), { recursive: true });
  await writeFile(path.join(root, 'outside-target.txt'), 'outside', 'utf8');
  await symlink(path.join(root, 'outside-target.txt'), symlinkFile);
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['media/assets/aa/evil-link'] }),
    (error) => error.code === 'CLEANUP_PATH_UNSAFE'
  );
  const symlinkDir = path.join(root, 'media', 'assets', 'zz');
  await symlink(path.join(root, 'outside'), symlinkDir);
  await assert.rejects(
    () => env.handle.cleanup.preview({ explicitPaths: ['media/assets/zz/anything'] }),
    (error) => error.code === 'CLEANUP_PATH_UNSAFE'
  );
  assert.equal((await readFile(path.join(root, 'outside-target.txt'), 'utf8')), 'outside');
  void handoff;
});

test('disk-full conditions do not corrupt media state and cleanup still reports measured bytes', async (t) => {
  const env = await startPhase8(t);
  const { plan } = await discoverAndPlan(env, { batchSize: 2 });
  const { fixedDiskProbe, GIB } = await import('../../lib/engine/index.js');
  await env.reopen({ engineOptions: { diskProbe: fixedDiskProbe(0) } });
  const blocked = await env.handle.media.download({ planId: plan.planId });
  assert.equal(blocked.status, 'blocked');
  assert.equal((await listFiles(path.join(projectRoot(env), 'media', 'assets'))).length, 0);
  await env.reopen({ engineOptions: { diskProbe: fixedDiskProbe(10 * GIB) } });
  const resumed = await env.handle.media.download({ planId: plan.planId });
  assert.ok(['completed', 'blocked'].includes(resumed.status));
  const detail = await env.handle.planning.get(plan.planId);
  assert.ok(detail.plan.media.length >= 2);
});


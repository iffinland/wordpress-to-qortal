import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';

/**
 * BUG-002 owner diagnostics: prove that the IPC responses for handoff
 * preparation and ZIP export stay small and structured-clone safe even for a
 * 29-resource handoff. Payload bytes must never cross IPC; the ZIP is built in
 * the engine host process, not the Electron main/renderer process.
 */
function assertCloneSafe(value, label) {
  assert.ok(JSON.stringify(value).length > 0, label + ' is not serializable');
  const seen = new WeakSet();
  const walk = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    assert.ok(!Buffer.isBuffer(entry), label + ' contains a Buffer');
    assert.ok(!(entry instanceof Uint8Array), label + ' contains a Uint8Array');
    if (seen.has(entry)) return;
    seen.add(entry);
    for (const child of Object.values(entry)) walk(child);
  };
  walk(value);
}

test('a 29-resource prepare/export response is small and clone-safe', async (t) => {
  const posts = Array.from({ length: 20 }, (_, index) => makePost(index, {
    id: 101 + index,
    slug: 'payload-post-' + index,
    title: 'Payload post ' + index,
    content: '<p>Body ' + index + '</p><p>' + 'x'.repeat(400_000) + '</p>'
  }));
  const env = await startPhase3(t, { posts });
  await env.handle.source.discover({ perPage: 100 });
  const plan = await env.handle.planning.create({ batchSize: 20, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  const selection = plan.plan.entries.map((entry) => entry.sourceKey);
  const prepared = await env.handle.publication.prepare({ planId: plan.planId, selection });
  assert.equal(prepared.resources.length, 29);
  const preparedJson = JSON.stringify(prepared);
  assert.ok(preparedJson.length < 1_000_000, 'prepare response is too large for IPC: ' + preparedJson.length);
  assertCloneSafe(prepared, 'prepare');

  // Simulate an IPC timeout guard: the response contains no payload bytes.
  assert.equal(prepared.resources.some((resource) => resource.payload !== undefined), false);

  const exported = await env.handle.publication.exportBundle(prepared.handoffId);
  assert.ok(exported.absolutePath.endsWith('.zip'));
  assert.ok(exported.bytes > 0);
  const exportJson = JSON.stringify(exported);
  assert.ok(exportJson.length < 10_000, 'export response is too large for IPC: ' + exportJson.length);
  assertCloneSafe(exported, 'export');
  const info = await stat(path.resolve(exported.absolutePath));
  assert.equal(info.size, exported.bytes);
});

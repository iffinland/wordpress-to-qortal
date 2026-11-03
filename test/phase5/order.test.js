import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BATCH_RESOURCES,
  normalizePublishOutcome,
  planBatches,
  orderResources
} from '../../lib/engine/publication/index.js';

function resource(id, kind, dependsOn = [], order = 0) {
  return {
    id,
    kind,
    service: 'DOCUMENT',
    name: 'SyntheticSite',
    identifier: id.toLowerCase(),
    dependsOn,
    order
  };
}

test('batching splits at 20 and never schedules a dependent before its prerequisite', () => {
  const media = [resource('res_media00001', 'media')];
  const content = Array.from({ length: 25 }, (_, index) =>
    resource('res_content' + String(index).padStart(4, '0'), 'content', [media[0].id], index)
  );
  const indexes = [resource('res_index00001', 'index', content.map((entry) => entry.id), 1)];
  const manifest = [resource('res_manifest01', 'manifest', indexes.map((entry) => entry.id), 1)];
  const batches = planBatches([...manifest, ...indexes, ...content, ...media]);
  assert.ok(batches.length >= 3);
  assert.ok(batches.every((batch) => batch.length <= MAX_BATCH_RESOURCES));
  const completed = new Set();
  for (const batch of batches) {
    for (const item of batch) {
      assert.ok(item.dependsOn.every((dependency) => completed.has(dependency)));
    }
    for (const item of batch) completed.add(item.id);
  }
  assert.equal(completed.size, 28);
  // Qortal Core defaults to 25 unconfirmed transactions per account; the
  // publisher stays at 20 resources per request and stops on pending results.
  assert.equal(MAX_BATCH_RESOURCES, 20);
  assert.ok(MAX_BATCH_RESOURCES <= 25);
  assert.throws(() => planBatches(content, { maxBatch: 21 }), /maxBatch/);
});

test('ordering is stable across media, content, index and manifest phases', () => {
  const resources = [
    resource('res_manifest01', 'manifest', ['res_index00001'], 1),
    resource('res_index00001', 'index', ['res_content00001'], 1),
    resource('res_content00001', 'content', ['res_media00001'], 1),
    resource('res_media00001', 'media', [], 1)
  ];
  assert.deepEqual(orderResources(resources).map((entry) => entry.kind), ['media', 'content', 'index', 'manifest']);
});

test('success arrays, partial failures and thrown errors are normalized without auto-retry', () => {
  const resources = [
    { id: 'res_a000000001', service: 'DOCUMENT', name: 'N', identifier: 'a' },
    { id: 'res_b000000001', service: 'DOCUMENT', name: 'N', identifier: 'b' }
  ];
  const success = normalizePublishOutcome({
    resources,
    response: [{ identifier: 'a', signature: 'sig-a' }, { identifier: 'b', signature: 'sig-b' }]
  });
  assert.deepEqual(success.results.map((entry) => entry.status), ['submitted', 'submitted']);
  assert.equal(success.results[0].txSignature, 'sig-a');

  const partial = normalizePublishOutcome({
    resources,
    response: {
      message: 'Some resources failed',
      error: { unsuccessfulPublishes: [{ identifier: 'b', service: 'DOCUMENT', name: 'N', reason: 'boom' }] }
    }
  });
  assert.equal(partial.results[0].status, 'ambiguous');
  assert.equal(partial.results[1].status, 'failed');
  assert.equal(partial.partial, true);

  const declined = normalizePublishOutcome({ resources, error: new Error('User declined request') });
  assert.deepEqual(declined.results.map((entry) => entry.status), ['declined', 'declined']);

  const timeout = normalizePublishOutcome({ resources, error: new Error('The request timed out') });
  assert.deepEqual(timeout.results.map((entry) => entry.status), ['ambiguous', 'ambiguous']);
  assert.equal(timeout.responseShape, 'thrown');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../lib/engine/index.js';
import { makePost, startPhase3 } from '../../test-support/phase3/helpers.js';

async function discover(handle) {
  const result = await handle.source.discover({ mode: 'full', perPage: 100, progressEvery: 100 });
  assert.equal(result.status, 'completed');
  return result;
}

function datedPost(index, date) {
  return makePost(index, {
    date,
    date_gmt: date,
    modified: date,
    modified_gmt: date
  });
}

test('an inclusive end-of-day date filter selects content published on the last day', async (t) => {
  const posts = [
    datedPost(1, '2026-10-21T23:30:00'),
    datedPost(2, '2026-10-22T00:30:00'),
    datedPost(3, '2026-10-04T23:30:00')
  ];
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const result = await env.handle.planning.create({
    batchSize: 10,
    estimateMedia: false,
    persist: false,
    filters: {
      after: '2026-10-05T00:00:00.000Z',
      before: '2026-10-21T23:59:59.999Z',
      contentTypes: ['post']
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.stats.selected, 1);
  assert.deepEqual(result.plan.entries.map((entry) => entry.sourceKey), ['post:1001']);
  assert.equal(result.plan.selection.empty, false);
});

test('an empty date range explains exactly which filter excluded the content', async (t) => {
  const posts = [
    datedPost(1, '2026-11-01T10:00:00'),
    datedPost(2, '2026-11-03T10:00:00'),
    datedPost(3, '2026-11-05T10:00:00')
  ];
  const env = await startPhase3(t, { posts });
  await discover(env.handle);
  const result = await env.handle.planning.create({
    batchSize: 5,
    estimateMedia: false,
    persist: false,
    filters: {
      after: '2026-10-05T00:00:00.000Z',
      before: '2026-10-21T23:59:59.999Z',
      contentTypes: ['post', 'page']
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.stats.selected, 0);
  assert.equal(result.plan.status, 'ready');
  assert.equal(result.plan.selection.empty, true);
  assert.equal(result.plan.selection.emptyReason, 'NO_ITEMS_MATCH_FILTERS');
  assert.equal(result.plan.filterDiagnostics.indexed, 3);
  assert.equal(result.plan.filterDiagnostics.matched, 0);
  assert.equal(result.plan.filterDiagnostics.publishedAfterBefore, 3);
  const explanation = result.plan.selection.emptyExplanation.join(' ');
  assert.match(explanation, /No indexed item matches the current filters/);
  assert.match(explanation, /3 item\(s\) were published after the upper bound/);
  assert.match(explanation, /Published-date filter: after 2026-10-05T00:00:00.000Z and before 2026-10-21T23:59:59.999Z/);
});

test('content type exclusions are counted and explained', async (t) => {
  const env = await startPhase3(t, { posts: [datedPost(1, '2026-11-01T10:00:00')] });
  await discover(env.handle);
  const result = await env.handle.planning.create({
    batchSize: 5,
    estimateMedia: false,
    persist: false,
    filters: { contentTypes: ['page'] }
  });
  assert.equal(result.stats.selected, 0);
  assert.equal(result.plan.filterDiagnostics.contentTypeExcluded, 1);
  assert.match(result.plan.selection.emptyExplanation.join(' '), /1 item\(s\) were excluded by content type/);
});

test('planning without discovery fails with an explicit error code instead of an empty plan', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1)] });
  // Deliberately do not discover.
  const result = await env.handle.planning.create({ batchSize: 5, estimateMedia: false, persist: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'SOURCE_DISCOVERY_REQUIRED');
  assert.match(result.error.message, /No completed source discovery batch/);
});

test('the same JSON-RPC wizard calls drive discovery to a five-post plan preview', async (t) => {
  const posts = Array.from({ length: 7 }, (_, index) => datedPost(index + 1, '2026-11-0' + (index + 1) + 'T10:00:00'));
  const env = await startPhase3(t, { posts });
  const discovered = await discover(env.handle);
  assert.equal(discovered.status, 'completed');
  const result = await env.handle.planning.create({
    batchSize: 5,
    estimateMedia: false,
    persist: false,
    filters: {
      contentTypes: ['post', 'page'],
      after: '2026-11-01T00:00:00.000Z',
      before: '2026-11-07T23:59:59.999Z'
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.stats.selected, 5);
  assert.equal(result.plan.entries.filter((entry) => entry.qdn).length, 5);
  assert.ok(result.plan.entries.every((entry) => entry.contentType === 'post'));
  assert.ok(result.plan.entries.every((entry) => Date.parse(entry.publishedAt) >= Date.parse('2026-11-01T00:00:00.000Z')));
});

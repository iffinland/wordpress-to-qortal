import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../lib/engine/index.js';
import { EVENT_TYPES, validateEvent } from '../../lib/engine/events.js';
import { tempDir } from '../../test-support/engine/env.js';

test('operations emit ordered qms-event@1 events with stable codes', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Events' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));

  const result = await handle.validate();
  assert.equal(result.status, 'completed');
  const events = handle.events.list();
  assert.ok(events.length >= 6);

  let previous = 0;
  for (const event of events) {
    validateEvent(event);
    assert.equal(event.schema, 'qms-event@1');
    assert.equal(event.project_id, project.id);
    assert.ok(event.seq > previous);
    previous = event.seq;
  }

  const types = new Set(events.map((event) => event.type));
  assert.ok(types.has('operation_started'));
  assert.ok(types.has('progress_updated'));
  assert.ok(types.has('warning_emitted'));
  assert.ok(types.has('operation_completed'));
  assert.ok(types.has('state_snapshot'));
  assert.ok(types.has('progress_updated'));

  const progressSeqs = events.filter((event) => event.progress).map((event) => event.progress.completed);
  assert.deepEqual(progressSeqs, [1, 2, 3]);
  const completed = events.filter((event) => event.type === 'operation_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].code, 'OPERATION_COMPLETED');

  // Reconstruction from events plus run snapshot matches the live view.
  const progress = handle.progress(result.runId);
  assert.equal(progress.state, 'completed');
  assert.deepEqual(progress.progress, { completed: 3, total: 3, bytes: 0 });
  assert.equal(progress.lastEventSeq, events.at(-1).seq);
  assert.equal(progress.eventCount, events.filter((event) => event.run_id === result.runId).length);
  assert.equal(progress.complete, true);
});

test('event sequence continues after restart and events remain ordered', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Restart Events' });
  const first = await engine.projects.open(project.id);
  const firstRun = await first.validate();
  const lastSeqBefore = first.events.list().at(-1).seq;
  await first.close();

  const reopened = await engine.projects.open(project.id);
  const secondRun = await secondValidate(reopened);
  async function secondValidate(handle) {
    return handle.validate();
  }
  const events = reopened.events.list();
  assert.ok(events[0].seq <= lastSeqBefore + 1);
  for (let index = 1; index < events.length; index += 1) {
    assert.equal(events[index].seq, events[index - 1].seq + 1);
  }
  assert.notEqual(firstRun.runId, secondRun.runId);
  assert.equal(reopened.progress(secondRun.runId).state, 'completed');
  const persisted = reopened.events.list({ runId: secondRun.runId });
  assert.equal(persisted[0].type, 'operation_started');
  assert.equal(persisted.at(-1).type, 'state_snapshot');
  await reopened.close();
});

test('warning events redact credential-like detail keys', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Redaction' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));
  const [event] = await handle.events.emit({
    type: 'warning_emitted',
    code: 'TEST_WARNING',
    message: 'Sensitive values must not leak',
    level: 'warning',
    details: {
      password: 'hunter2',
      apiKey: 'secret-key',
      nested: { seed: 'words', safe: 'visible' }
    }
  });
  assert.equal(event.details.password, '[redacted]');
  assert.equal(event.details.apiKey, '[redacted]');
  assert.equal(event.details.nested.seed, '[redacted]');
  assert.equal(event.details.nested.safe, 'visible');
  assert.doesNotMatch(JSON.stringify(event), /hunter2|secret-key|words/);
});

test('cancellation emits operation_cancelled and leaves a terminal run', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Cancel' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));

  const controller = new AbortController();
  const unsubscribe = handle.events.subscribe((event) => {
    if (event.type === 'progress_updated' && event.phase === 'paths') {
      controller.abort('test cancellation');
    }
  });
  const result = await handle.validate({ signal: controller.signal });
  unsubscribe();
  assert.equal(result.status, 'cancelled');
  const events = handle.events.list({ runId: result.runId });
  assert.ok(events.some((event) => event.type === 'operation_cancelled'));
  assert.equal(handle.progress(result.runId).state, 'cancelled');
});

test('a failing operation emits operation_failed with a retryability flag', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Failure' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));
  await handle.update({
    compatibility: { profileId: 'no-such-profile', resourcePrefix: 'cr', qdnIdentifiers: {} }
  });
  const result = await handle.validate();
  assert.equal(result.status, 'failed');
  assert.ok(result.error);
  const events = handle.events.list({ runId: result.runId });
  const failed = events.find((event) => event.type === 'operation_failed');
  assert.ok(failed);
  assert.equal(failed.level, 'error');
  assert.equal(typeof failed.retryable, 'boolean');
  assert.equal(handle.progress(result.runId).state, 'failed');
});

test('concurrent event emission keeps a unique, contiguous sequence', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Concurrent Events' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));
  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    handle.events.emit({
      type: 'progress_updated',
      code: 'CONCURRENT_TEST',
      message: `event ${index}`,
      progress: { completed: index, total: 20 }
    })
  ));
  const events = handle.events.list();
  const seqs = events.map((event) => event.seq);
  assert.deepEqual(seqs, Array.from({ length: events.length }, (_, index) => index + 1));
  assert.equal(new Set(seqs).size, seqs.length);
});

test('the run service exposes explicit cancellation', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Run Cancel' });
  const handle = await engine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));

  const context = await handle.runs.start({ kind: 'manual.test' });
  await handle.runs.cancel(context.runId, 'test cancel');
  await assert.rejects(
    () => context.progress({ completed: 1, total: 1 }),
    (error) => error.code === 'OPERATION_CANCELLED'
  );
  await context.cancel();
  const progress = handle.progress(context.runId);
  assert.equal(progress.state, 'cancelled');
  assert.equal(progress.complete, true);
  const events = handle.events.list({ runId: context.runId });
  assert.equal(events.filter((event) => event.type === 'operation_cancelled').length, 1);
});

test('the event schema rejects unknown types and invalid sequence numbers', () => {
  assert.throws(() => validateEvent({
    schema: 'qms-event@1',
    seq: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    project_id: 'prj_x',
    run_id: null,
    item_id: null,
    phase: null,
    type: 'not_a_real_type',
    level: 'info',
    code: 'TEST',
    message: 'x',
    progress: null,
    retryable: false,
    details: {}
  }), { code: 'INVALID_EVENT' });
  assert.throws(() => validateEvent({
    schema: 'qms-event@1',
    seq: 0,
    timestamp: '2026-01-01T00:00:00.000Z',
    project_id: 'prj_x',
    run_id: null,
    item_id: null,
    phase: null,
    type: EVENT_TYPES[0],
    level: 'info',
    code: 'TEST',
    message: 'x',
    progress: null,
    retryable: false,
    details: {}
  }), { code: 'INVALID_EVENT' });
});

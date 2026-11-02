import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createEngine } from '../../lib/engine/index.js';
import { defaultDataRoot } from '../../lib/engine/storage/paths.js';
import { tempDir } from '../../test-support/engine/env.js';

test('two isolated projects keep independent roots, settings and state', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });

  const first = await engine.projects.create({
    name: 'Corbett Report',
    profileId: 'corbettreport',
    settings: { batchSize: 15 },
    target: { qdnName: 'CorbettReport' }
  });
  const second = await engine.projects.create({
    name: 'Second Archive',
    settings: { batchSize: 3, custom: true },
    target: { qdnName: 'SecondArchive' }
  });

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.storageRoot, second.storageRoot);
  assert.ok(first.storageRoot.startsWith(dataRoot));
  assert.ok(second.storageRoot.startsWith(dataRoot));
  assert.equal(first.resourcePrefix, 'cr');
  assert.equal(second.resourcePrefix, null);

  const firstHandle = await engine.projects.open(first.id);
  const secondHandle = await engine.projects.open(second.id);

  const firstResult = await firstHandle.validate();
  assert.equal(firstResult.status, 'completed');
  assert.equal(secondHandle.snapshot().runs.length, 0);
  assert.equal(secondHandle.snapshot().storage.lastEventSeq, 1);
  assert.equal(firstHandle.project.settings.batchSize, 15);
  assert.equal(secondHandle.project.settings.batchSize, 3);

  const firstEvents = firstHandle.events.list();
  const secondEvents = secondHandle.events.list();
  assert.ok(firstEvents.length > 1);
  assert.deepEqual(secondEvents.map((event) => event.type), ['state_snapshot']);
  assert.ok(firstEvents.every((event) => event.project_id === first.id));
  const lastSeqBeforeClose = firstEvents.at(-1).seq;

  await firstHandle.close();
  await secondHandle.close();

  const listed = await engine.projects.list();
  assert.equal(listed.length, 2);

  // Re-open with a fresh engine instance: state survives process restart.
  const restarted = createEngine({ dataRoot });
  const reopened = await restarted.projects.open(first.id);
  const snapshot = reopened.snapshot();
  assert.equal(snapshot.project.settings.batchSize, 15);
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].state, 'completed');
  assert.equal(snapshot.storage.lastEventSeq, lastSeqBeforeClose + 1);
  const progress = reopened.progress(firstResult.runId);
  assert.equal(progress.state, 'completed');
  assert.deepEqual(progress.progress, { completed: 3, total: 3, bytes: 0 });
  await reopened.close();
  await restarted.close();
  await engine.close();
});

test('a second engine instance cannot write to an open project', async (t) => {
  const dataRoot = await tempDir(t);
  const firstEngine = createEngine({ dataRoot });
  const project = await firstEngine.projects.create({ name: 'Locked' });
  const handle = await firstEngine.projects.open(project.id);
  t.after(() => handle.close().catch(() => {}));

  const secondEngine = createEngine({ dataRoot });
  await assert.rejects(
    () => secondEngine.projects.open(project.id),
    (error) => error.code === 'PROJECT_LOCKED' && error.details.owner.pid === process.pid
  );
  // The lock also guards the state store itself, not just the open() call.
  await handle.lock.release();
  await assert.rejects(
    () => handle.events.emit({ type: 'warning_emitted', code: 'AFTER_LOCK_LOSS', message: 'x' }),
    { code: 'LOCK_LOST' }
  );
  handle.lock.released = true;
  await handle.store.close();
  await secondEngine.projects.open(project.id).then((second) => second.close());
});

test('project identifiers are validated to prevent path traversal', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  await assert.rejects(() => engine.projects.get('../../etc/passwd'), { code: 'INVALID_PROJECT_ID' });
  await assert.rejects(() => engine.projects.get('prj_missing'), { code: 'PROJECT_NOT_FOUND' });

  const created = await engine.projects.create({ name: 'Duplicate Id' });
  await assert.rejects(
    () => engine.projects.create({ name: 'Duplicate Id', id: created.id }),
    { code: 'PROJECT_EXISTS' }
  );
  await assert.rejects(
    () => engine.projects.create({ name: 'Bad Id', id: 'prj_has spaces' }),
    { code: 'INVALID_PROJECT_ID' }
  );
});

test('a project document from a newer app version is rejected', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Future Project' });
  const projectFile = path.join(project.storageRoot, 'project.json');
  const document = JSON.parse(await readFile(projectFile, 'utf8'));
  await writeFile(projectFile, JSON.stringify({ ...document, version: 2 }, null, 2));

  await assert.rejects(
    () => engine.projects.open(project.id),
    (error) => error.code === 'PROJECT_SCHEMA_UNSUPPORTED' && /newer/i.test(error.message)
  );
  const raw = JSON.parse(await readFile(projectFile, 'utf8'));
  assert.equal(raw.version, 2); // untouched, fail closed
});

test('archive hides a project and deleteLocalData moves it to recoverable trash', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({ name: 'Archive Me' });

  const archived = await engine.projects.archive(project.id);
  assert.equal(archived.archived, true);
  assert.equal((await engine.projects.list()).length, 0);
  assert.equal((await engine.projects.list({ includeArchived: true })).length, 1);
  await assert.rejects(() => engine.projects.open(project.id), { code: 'PROJECT_ARCHIVED' });

  const second = await engine.projects.create({ name: 'Delete Me' });
  const deleted = await engine.projects.archive(second.id, { deleteLocalData: true });
  assert.ok(deleted.recoverablePath.includes(path.join('trash')));
  await assert.rejects(() => stat(second.storageRoot), /ENOENT/);
  assert.ok(await stat(deleted.recoverablePath));
});

test('project settings can be updated without touching other projects', async (t) => {
  const dataRoot = await tempDir(t);
  const engine = createEngine({ dataRoot });
  const first = await engine.projects.create({ name: 'First' });
  const second = await engine.projects.create({ name: 'Second' });

  const updated = await engine.projects.update(first.id, {
    name: 'First Renamed',
    settings: { batchSize: 15 }
  });
  assert.equal(updated.project.name, 'First Renamed');
  assert.equal(updated.project.slug, 'first-renamed');
  assert.equal(updated.project.settings.batchSize, 15);

  const { project: untouched, paths: untouchedPaths } = await engine.projects.get(second.id);
  assert.equal(untouched.name, 'Second');
  assert.deepEqual(untouched.settings, {});
  const raw = JSON.parse(await readFile(path.join(untouchedPaths.root, 'project.json'), 'utf8'));
  assert.equal(raw.schema, 'qms-project@1');
});

test('default data root follows XDG conventions', () => {
  assert.equal(defaultDataRoot({ XDG_DATA_HOME: '/tmp/xdg-data' }),
    path.join('/tmp/xdg-data', 'qortal-migration-studio'));
  assert.equal(defaultDataRoot({ QMS_DATA_ROOT: '/tmp/override' }), path.resolve('/tmp/override'));
  assert.equal(defaultDataRoot({ XDG_DATA_HOME: 'relative/path' }),
    path.join(os.homedir(), '.local', 'share', 'qortal-migration-studio'));
});

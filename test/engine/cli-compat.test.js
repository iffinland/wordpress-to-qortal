import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEngine } from '../../lib/engine/index.js';
import { loadProfile as loadLegacyProfile } from '../../src/profile.js';
import { tempDir } from '../../test-support/engine/env.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// Exact Phase 0 command surface. Adding a script is allowed; changing or
// removing one would break the Corbett compatibility contract.
const LEGACY_SCRIPTS = {
  start: 'npm run batch:status',
  setup: 'bash scripts/setup-linux.sh',
  doctor: 'node scripts/doctor.js',
  test: 'node --test',
  inspect: 'node src/inspect.js',
  dump: 'node src/dump.js',
  convert: 'node src/convertRaw.js',
  'plan-media': 'node src/planMedia.js',
  'download-media': 'node src/downloadMedia.js',
  validate: 'node src/validate.js',
  'validate:media': 'node src/validate.js --require-media',
  'validate:media:batch': 'node src/validate.js --require-media --allow-missing-media',
  'prepare-publish': 'node src/preparePublish.js',
  publish: 'node src/publish.js',
  'batch:status': 'node scripts/runCorbettBatch.js status',
  'batch:init': 'node scripts/runCorbettBatch.js init',
  'batch:next': 'node scripts/runCorbettBatch.js next',
  'batch:retry': 'node scripts/runCorbettBatch.js retry',
  'batch:complete': 'node scripts/runCorbettBatch.js complete',
  'batch:catalog': 'node scripts/runCorbettBatch.js catalog',
  'batch:cleanup': 'node scripts/runCorbettBatch.js cleanup',
  preview: 'npm --prefix viewer run dev',
  'migration:build': 'npm --prefix viewer run build',
  'migration:preview': 'npm --prefix viewer run preview',
  'cms:dev': 'npm --prefix corbettreport run dev',
  'cms:build': 'npm --prefix corbettreport run build',
  'cms:preview': 'npm --prefix corbettreport run preview',
  check: 'npm test && npm run migration:build && npm run cms:build',
  'package:source': 'node scripts/createMigrationPackage.js',
  'package:zip': 'node scripts/createMigrationZip.js',
  'package:migration-qapp': 'node scripts/createMigrationQappZip.js --profile=corbettreport',
  'package:cms-qapp': 'node scripts/createCmsQappZip.js --profile=corbettreport',
  'package:tester-bundle': 'node scripts/createTesterBundle.js',
  'package:release': 'npm run package:zip && npm run package:migration-qapp && npm run package:cms-qapp'
};

test('the legacy npm command surface is unchanged', async () => {
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(LEGACY_SCRIPTS)) {
    assert.equal(pkg.scripts[name], command, `npm script changed: ${name}`);
  }
  assert.equal(pkg.scripts.qms, 'node bin/qms.js');

  const files = [
    'src/profile.js',
    'src/config.js',
    'src/wpClient.js',
    'src/convert.js',
    'src/convertRaw.js',
    'src/planMedia.js',
    'src/downloadMedia.js',
    'src/validate.js',
    'src/preparePublish.js',
    'src/publish.js',
    'scripts/runCorbettBatch.js',
    'profiles/corbettreport/profile.json'
  ];
  for (const relative of files) {
    assert.ok(await stat(path.join(REPO_ROOT, relative)), `missing legacy file: ${relative}`);
  }
});

test('the engine compatibility layer produces the Corbett identifiers', async (t) => {
  const legacy = loadLegacyProfile('corbettreport');
  const engine = createEngine({ dataRoot: await tempDir(t) });
  const viaEngine = engine.compat.loadProfile('corbettreport');
  assert.deepEqual(viaEngine.qdnIdentifiers, legacy.qdnIdentifiers);
  assert.equal(legacy.resourcePrefix, 'cr');
  assert.deepEqual(legacy.qdnIdentifiers, {
    qdn_manifest: 'cr-qdn-manifest',
    posts_index: 'cr-posts-index',
    pages_index: 'cr-pages-index',
    categories: 'cr-categories',
    tags: 'cr-tags',
    media_map: 'cr-media-map',
    url_map: 'cr-url-map',
    import_manifest: 'cr-import-manifest'
  });

  const project = await engine.projects.create({ name: 'Compat', profileId: 'corbettreport' });
  const { project: document } = await engine.projects.get(project.id);
  assert.deepEqual(document.compatibility.qdnIdentifiers, legacy.qdnIdentifiers);
  assert.equal(document.source.adapter, 'wordpress');
});

test('qms CLI project commands work and remain non-destructive', async (t) => {
  const dataRoot = await tempDir(t);
  const env = { ...process.env, QMS_DATA_ROOT: dataRoot };
  const cli = path.join(REPO_ROOT, 'bin', 'qms.js');

  const help = await execFileAsync(process.execPath, [cli, '--help'], { cwd: REPO_ROOT, env });
  assert.match(help.stdout, /qms \d/);
  assert.match(help.stdout, /project create/);

  const created = await execFileAsync(process.execPath, [
    cli, 'project', 'create', '--name', 'CLI Project', '--profile', 'corbettreport', '--json'
  ], { cwd: REPO_ROOT, env });
  const project = JSON.parse(created.stdout);
  assert.match(project.id, /^prj_/);
  assert.equal(project.profileId, 'corbettreport');

  const listed = await execFileAsync(process.execPath, [cli, 'project', 'list', '--json'], { cwd: REPO_ROOT, env });
  assert.equal(JSON.parse(listed.stdout).length, 1);

  const validated = await execFileAsync(process.execPath, [
    cli, 'project', 'validate', project.id, '--json'
  ], { cwd: REPO_ROOT, env });
  const result = JSON.parse(validated.stdout);
  assert.equal(result.status, 'completed');
  assert.ok(result.runId);

  const events = await execFileAsync(process.execPath, [
    cli, 'events', project.id, '--json'
  ], { cwd: REPO_ROOT, env });
  const eventList = JSON.parse(events.stdout);
  assert.ok(eventList.some((event) => event.type === 'operation_completed'));

  const compat = await execFileAsync(process.execPath, [cli, 'compat', 'list', '--json'], { cwd: REPO_ROOT, env });
  const commands = JSON.parse(compat.stdout);
  for (const name of Object.keys(LEGACY_SCRIPTS)) {
    assert.ok(commands.some((entry) => entry.name === name), `compat list missing ${name}`);
  }

  const archived = await execFileAsync(process.execPath, [
    cli, 'project', 'archive', project.id, '--json'
  ], { cwd: REPO_ROOT, env });
  assert.equal(JSON.parse(archived.stdout).archived, true);
});

test('the legacy batch:status command still runs read-only', async (t) => {
  const batchRoot = await tempDir(t);
  const result = await execFileAsync(process.execPath, ['scripts/runCorbettBatch.js', 'status'], {
    cwd: REPO_ROOT,
    env: { ...process.env, CORBETT_BATCH_ROOT: batchRoot }
  });
  const status = JSON.parse(result.stdout);
  assert.equal(typeof status.batch_size, 'number');
  assert.equal(status.total_batches, 0);
  assert.equal(status.pending_batch, null);
  assert.equal(status.historical_exhausted, false);
});

test('engine modules have no Electron dependency', async () => {
  const { readdir } = await import('node:fs/promises');
  const engineRoot = path.join(REPO_ROOT, 'lib', 'engine');
  const offenders = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.name.endsWith('.js')) {
        const source = await readFile(target, 'utf8');
        if (/from\s+['"]electron['"]|require\(['"]electron['"]\)|ipcRenderer|BrowserWindow/.test(source)) {
          offenders.push(path.relative(REPO_ROOT, target));
        }
      }
    }
  }
  await walk(engineRoot);
  assert.deepEqual(offenders, []);
});

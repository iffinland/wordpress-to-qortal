import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { inspectQappZip } from '../../scripts/release/artifact-set.mjs';
import { runThreeArtifactGate } from '../../scripts/release/three-artifact-gate.mjs';

const MTIME = new Date('1980-01-01T00:00:00.000Z');
const VERSION = '0.6.1';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function qappFiles({ kind, version = VERSION }) {
  const publisher = kind === 'publisher';
  const schemas = publisher
    ? ['qms-publication-handoff@1', 'qms-publication-receipt@1', 'qms-cms-bundle@1']
    : ['qms-cms-template-config@1', 'qms-cms-manifest@1', 'qms-qdn-manifest@1'];
  const title = publisher ? 'Qortal Migration Publisher' : 'Qortal Site';
  return {
    'index.html': [
      '<!doctype html><html><head><title>' + title + '</title>',
      '<link rel="stylesheet" href="./assets/app.css"></head>',
      '<body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>'
    ].join(''),
    'assets/app.css': 'body{color:#fff}',
    'assets/app.js': 'const version="' + version + '";const schemas=' + JSON.stringify(schemas) + ';'
  };
}

function makeZip(entries) {
  const payload = {};
  for (const [name, text] of Object.entries(entries)) {
    payload[name] = [new TextEncoder().encode(text), { level: 6, mtime: MTIME }];
  }
  return Buffer.from(zipSync(payload, { level: 6, mtime: MTIME }));
}

async function writeZip(file, entries) {
  await writeFile(file, makeZip(entries));
  return sha256(await readFile(file));
}

async function makeFakeRelease() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-release-gate-'));
  await mkdir(path.join(root, 'desktop/release'), { recursive: true });
  await mkdir(path.join(root, 'release'), { recursive: true });
  const release = {
    schema: 'qms-release@1',
    product: 'Qortal Migration Studio',
    version: VERSION,
    channel: 'alpha',
    signing: 'unsigned',
    architecture: 'amd64',
    debianPackage: 'qortal-migration-studio',
    releaseNotes: 'RELEASE.md'
  };
  await writeFile(path.join(root, 'qms-release.json'), JSON.stringify(release, null, 2));
  await writeFile(path.join(root, 'RELEASE.md'), '# Release\n<!-- qms-release-version: ' + VERSION + ' -->\n');
  const debName = 'qortal-migration-studio_' + VERSION + '_amd64.deb';
  const debPath = path.join(root, 'desktop/release', debName);
  await writeFile(debPath, '');
  await truncate(debPath, 31 * 1024 * 1024);
  const debBytes = await readFile(debPath);
  await writeFile(path.join(root, 'desktop/release/artifact.json'), JSON.stringify({
    schema: 'qms-deb-artifact@1',
    artifact: debName,
    bytes: debBytes.length,
    sha256: sha256(debBytes),
    version: VERSION,
    debianVersion: VERSION,
    architecture: 'amd64',
    channel: 'alpha',
    signing: 'unsigned',
    sourceCommit: 'test-commit',
    sourceTree: 'test-tree',
    branch: 'test-branch',
    dirty: false
  }, null, 2));
  await writeFile(path.join(root, 'desktop/release/validation.json'), JSON.stringify({ checks: 10, failed: 0, version: VERSION }, null, 2));
  const publisher = path.join(root, 'release/qortal-migration-publisher-v' + VERSION + '.zip');
  const cms = path.join(root, 'release/qortal-migration-generic-cms-v' + VERSION + '.zip');
  await writeZip(publisher, qappFiles({ kind: 'publisher' }));
  await writeZip(cms, qappFiles({ kind: 'cms' }));
  return { root, release, publisher, cms };
}

function withSourceEnv(fn) {
  const previous = {};
  const values = {
    QMS_SOURCE_COMMIT: 'test-commit',
    QMS_SOURCE_TREE: 'test-tree',
    QMS_SOURCE_BRANCH: 'test-branch',
    QMS_SOURCE_DIRTY: '0',
    QMS_SOURCE_EPOCH: '1762300000'
  };
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('a root-layout Publisher Q-App ZIP passes validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const file = path.join(root, 'publisher.zip');
  await writeZip(file, qappFiles({ kind: 'publisher' }));
  const result = await inspectQappZip(file, { kind: 'publisher', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.files, ['assets/app.css', 'assets/app.js', 'index.html']);
});

test('a root-layout Generic CMS Q-App ZIP passes validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const file = path.join(root, 'cms.zip');
  await writeZip(file, qappFiles({ kind: 'cms' }));
  const result = await inspectQappZip(file, { kind: 'cms', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('a ZIP with a parent directory fails the root-layout requirement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const file = path.join(root, 'nested.zip');
  const files = qappFiles({ kind: 'cms' });
  const nested = Object.fromEntries(Object.entries(files).map(([name, value]) => ['app/' + name, value]));
  await writeZip(file, nested);
  const result = await inspectQappZip(file, { kind: 'cms', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /nested under a parent directory/);
});

test('absolute asset URLs, missing assets and source maps fail', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const files = qappFiles({ kind: 'cms' });
  files['index.html'] = '<div id="root"></div><script src="/assets/app.js"></script>';
  files['assets/app.js.map'] = '{}';
  const file = path.join(root, 'bad.zip');
  await writeZip(file, files);
  const result = await inspectQappZip(file, { kind: 'cms', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, false);
  const errors = result.errors.join('; ');
  assert.match(errors, /non-relative asset/);
  assert.match(errors, /source map/);
});

test('development fixtures, source files and package metadata are rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const files = qappFiles({ kind: 'cms' });
  files['fixtures/content.json'] = '{}';
  files['src/App.tsx'] = 'export default 1;';
  files['package.json'] = '{}';
  const file = path.join(root, 'dev.zip');
  await writeZip(file, files);
  const result = await inspectQappZip(file, { kind: 'cms', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, false);
  const errors = result.errors.join('; ');
  assert.match(errors, /development fixtures or tests/);
  assert.match(errors, /development source file/);
  assert.match(errors, /development package metadata/);
});

test('hardcoded identities and a missing release version fail validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-zip-'));
  const files = qappFiles({ kind: 'cms', version: '9.9.9' });
  files['assets/app.js'] += 'const owner="corbettreport";';
  const file = path.join(root, 'identity.zip');
  await writeZip(file, files);
  const result = await inspectQappZip(file, { kind: 'cms', version: VERSION });
  await rm(root, { recursive: true, force: true });
  assert.equal(result.ok, false);
  const errors = result.errors.join('; ');
  assert.match(errors, /hardcoded Corbett Report profile identity/);
  assert.match(errors, /does not carry the release version/);
});

test('the three-artifact gate passes only with all artifacts and writes complete checksums', async () => {
  const fake = await makeFakeRelease();
  await withSourceEnv(async () => {
    const result = await runThreeArtifactGate({ repoRoot: fake.root, tag: 'v0.6.1-alpha.1' });
    assert.equal(result.ok, true, result.failures.join('; '));
    assert.equal(result.manifest.artifacts.length, 3);
    const sums = await readFile(path.join(fake.root, 'release/SHA256SUMS'), 'utf8');
    for (const entry of result.manifest.artifacts) {
      assert.ok(sums.split('\n').some((line) => line.endsWith('  ' + entry.name)), 'missing ' + entry.name);
    }
    const manifest = JSON.parse(await readFile(path.join(fake.root, 'release/release-manifest.json'), 'utf8'));
    assert.equal(manifest.schema, 'qms-release-artifacts@1');
    assert.ok(manifest.compatibility.versionedManifests.includes('qms-publication-handoff@1'));

    await rm(fake.cms);
    const blocked = await runThreeArtifactGate({ repoRoot: fake.root });
    assert.equal(blocked.ok, false);
    assert.match(blocked.failures.join('; '), /cms: Required artifact is missing/);
  });
  await rm(fake.root, { recursive: true, force: true });
});

test('version mismatch between a ZIP bundle and the release descriptor fails', async () => {
  const fake = await makeFakeRelease();
  await writeZip(fake.cms, qappFiles({ kind: 'cms', version: '0.6.0' }));
  await withSourceEnv(async () => {
    const result = await runThreeArtifactGate({ repoRoot: fake.root });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('; '), /does not carry the release version/);
  });
  await rm(fake.root, { recursive: true, force: true });
});

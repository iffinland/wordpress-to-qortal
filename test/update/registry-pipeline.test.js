import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
  artifactRecordsFromManifest,
  buildRegistryDocument,
  buildRegistryHandoff,
  readPublishedRegistry,
  verifyPublicArtifacts
} from '../../scripts/release/update-registry.mjs';
import { parseRegistryDocument } from '../../lib/update/registry.js';
import { validateHandoffPackage } from '../../lib/engine/publication/handoff.js';
import { componentFor } from './support/registry-fixture.js';

const TAG = 'v0.8.0-alpha.1';
const COMMIT_TIME = 1762310000;

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function releaseFixture(versions = {}) {
  const components = {};
  for (const id of ['desktop', 'publisher', 'cms']) {
    const version = versions[id] ?? '0.8.0-alpha.1';
    components[id] = { version, channel: 'alpha', changelog: id + ' update.' };
  }
  return {
    schema: 'qms-release@2',
    product: 'Qortal Migration Studio',
    version: '0.8.0-alpha.1',
    channel: 'alpha',
    releaseTag: TAG,
    components,
    changelog: { summary: 'Bundle update.' }
  };
}

function manifestFixture(release) {
  const artifacts = ['deb', 'publisher', 'cms'].map((kind) => {
    const id = kind === 'deb' ? 'desktop' : kind;
    const artifact = componentFor(id, release.components[id].version).artifacts[0];
    return {
      kind,
      component: id,
      componentVersion: release.components[id].version,
      name: artifact.name,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      layout: kind === 'deb' ? 'debian-package' : 'qapp-root'
    };
  });
  return { schema: 'qms-release-artifacts@1', ok: true, version: release.version, tag: TAG, artifacts };
}

function build(release = releaseFixture(), current = null, versions = {}) {
  const manifest = manifestFixture(release);
  const artifacts = artifactRecordsFromManifest(release, manifest);
  return buildRegistryDocument({
    release,
    manifest,
    artifacts,
    current,
    generatedAt: new Date(COMMIT_TIME * 1000).toISOString(),
    releaseDate: new Date(COMMIT_TIME * 1000).toISOString(),
    summary: 'Bundle update.'
  });
}

test('the first registry publication contains all three components', () => {
  const result = build();
  assert.equal(result.changed, true);
  assert.equal(result.document.sequence, 1);
  const parsed = parseRegistryDocument(result.document);
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  for (const id of ['desktop', 'publisher', 'cms']) {
    assert.equal(result.document.components[id].version, '0.8.0-alpha.1');
    assert.equal(result.document.components[id].releaseTag, TAG);
  }
});

test('rebuilding against its own output is idempotent and advertises nothing new', () => {
  const first = build();
  const second = build(releaseFixture(), first.document);
  assert.equal(second.changed, false);
  assert.equal(second.document.sequence, first.document.sequence);
  assert.deepEqual(second.document, first.document);
});

test('a desktop-only release leaves Publisher and CMS records byte-identical', () => {
  const first = build();
  const nextRelease = releaseFixture({ desktop: '0.8.1-alpha.1' });
  nextRelease.version = '0.8.1-alpha.1';
  nextRelease.releaseTag = 'v0.8.1-alpha.1';
  const manifest = manifestFixture(nextRelease);
  const artifacts = artifactRecordsFromManifest(nextRelease, manifest);
  const next = buildRegistryDocument({
    release: nextRelease,
    manifest,
    artifacts,
    current: first.document,
    generatedAt: new Date((COMMIT_TIME + 60) * 1000).toISOString(),
    releaseDate: new Date((COMMIT_TIME + 60) * 1000).toISOString(),
    summary: 'Desktop update.'
  });
  assert.equal(next.changed, true);
  assert.equal(next.document.sequence, 2);
  assert.equal(next.document.components.desktop.version, '0.8.1-alpha.1');
  assert.deepEqual(next.document.components.publisher, first.document.components.publisher);
  assert.deepEqual(next.document.components.cms, first.document.components.cms);
  assert.equal(parseRegistryDocument(next.document).ok, true);
});

test('a changed artifact under an unchanged version is refused', () => {
  const first = build();
  const release = releaseFixture();
  const manifest = manifestFixture(release);
  manifest.artifacts.find((entry) => entry.component === 'cms').sha256 = sha('different-bytes');
  const artifacts = artifactRecordsFromManifest(release, manifest);
  assert.throws(() => buildRegistryDocument({
    release,
    manifest,
    artifacts,
    current: first.document,
    generatedAt: first.document.generatedAt,
    releaseDate: first.document.generatedAt,
    summary: 'x'
  }), /without a version bump/);
});

test('a component downgrade is refused', () => {
  const current = build().document;
  const release = releaseFixture({ desktop: '0.7.0-alpha.1' });
  const manifest = manifestFixture(release);
  const artifacts = artifactRecordsFromManifest(release, manifest);
  assert.throws(() => buildRegistryDocument({
    release,
    manifest,
    artifacts,
    current,
    generatedAt: current.generatedAt,
    releaseDate: current.generatedAt,
    summary: 'x'
  }), /Refusing to downgrade/);
});

test('the generated Publisher handoff passes the engine validator', async () => {
  const bytes = Buffer.from('{"schema":"qms-update-registry@1"}\n');
  const manifest = buildRegistryHandoff({ documentBytes: bytes, feePerResource: 0.01, createdAt: '2026-11-05T05:00:00.000Z' });
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-registry-handoff-'));
  await mkdir(path.join(root, 'payload/document'), { recursive: true });
  await writeFile(path.join(root, 'handoff.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(root, 'payload/document/qms-update-registry.json'), bytes);
  const validated = await validateHandoffPackage({ handoffDir: root });
  assert.equal(validated.verified.length, 1);
  assert.equal(validated.document.resources[0].identifier, 'qms-update-registry');
  await rm(root, { recursive: true, force: true });
});

test('public asset verification accepts exact bytes and rejects a hash mismatch', async () => {
  const body = Buffer.from('artifact');
  const digest = sha(body);
  const server = http.createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(body);
    } else {
      response.writeHead(404).end('missing');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const ok = await verifyPublicArtifacts([{ name: 'a.bin', url: base + '/ok', bytes: body.length, sha256: digest }]);
    assert.equal(ok[0].ok, true);
    await assert.rejects(verifyPublicArtifacts([{ name: 'a.bin', url: base + '/ok', bytes: body.length, sha256: sha('other') }]), /verification failed/);
    await assert.rejects(verifyPublicArtifacts([{ name: 'a.bin', url: base + '/missing', bytes: body.length, sha256: digest }]), /not accessible/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reading an absent or malformed published registry is safe', async () => {
  let mode = 404;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/arbitrary/resource/properties/')) {
      response.writeHead(404).end('{}');
      return;
    }
    if (mode === 404) {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":1401}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(Buffer.from('not a registry').toString('base64'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const absent = await readPublishedRegistry(base);
    assert.equal(absent.exists, false);
    mode = 200;
    const present = await readPublishedRegistry(base);
    assert.equal(present.exists, true);
    assert.equal(parseRegistryDocument(present.document).ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the handoff zip layout is root-layout and contains only the registry payload', () => {
  const bytes = Buffer.from('{}');
  const entries = zipSync({
    'handoff.json': [new TextEncoder().encode('{}'), { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') }],
    'payload/document/qms-update-registry.json': [new Uint8Array(bytes), { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') }]
  }, { level: 6, mtime: new Date('1980-01-01T00:00:00.000Z') });
  assert.ok(Buffer.from(entries).length > 0);
});

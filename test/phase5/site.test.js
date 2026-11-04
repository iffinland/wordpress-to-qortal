import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';
import { assertHandoffManifest, sealDocument, validateHandoffPackage, sha256Bytes } from '../../lib/engine/publication/index.js';
import { verifyResourceOnce } from '../../lib/engine/publication/remote.js';

async function prepareSite(t) {
  const env = await startPhase3(t, {
    posts: [makePost(1), makePost(2)],
    settings: { extra: { website: { cms: 'generic-cms', tagline: 'A neutral migrated site', theme: { colors: { accent: '#ff8800' } } } } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 3, estimateMedia: false });
  assert.equal(plan.status, 'completed');
  const selection = plan.plan.entries.filter((entry) => ['new', 'modified'].includes(entry.status)).map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const dir = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(dir, 'handoff.json'), 'utf8'));
  return { env, handoff, dir, manifest };
}

test('a Generic CMS site is packaged as an exact APP bundle after the manifest', async (t) => {
  const { env, handoff, dir, manifest } = await prepareSite(t);
  const site = manifest.resources.find((resource) => resource.kind === 'site');
  assert.ok(site, 'site resource exists');
  assert.equal(site.service, 'APP');
  assert.equal(site.name, 'SyntheticSite');
  assert.match(site.identifier, /^[a-z0-9][a-z0-9_-]{0,63}$/);
  assert.equal(site.dependsOn.length, 1);
  const dependency = manifest.resources.find((resource) => resource.id === site.dependsOn[0]);
  assert.equal(dependency.kind, 'manifest');
  assert.ok(site.order > dependency.order, 'site is published after the manifest');
  assert.equal(site.metadata.template, 'generic-cms');
  assert.equal(site.metadata.bundle.entrypoint, 'index.html');
  assert.ok(site.metadata.bundle.files.some((file) => file.path === 'qms-cms-config.json'));
  const zip = await readFile(path.join(dir, site.relativePath));
  assert.equal(zip.length, site.bytes);
  assert.equal(sha256Bytes(zip), site.sha256);
  const entries = unzipSync(zip);
  const config = JSON.parse(new TextDecoder().decode(entries['qms-cms-config.json']));
  assert.equal(config.site.title, 'SyntheticSite');
  assert.equal(config.site.tagline, 'A neutral migrated site');
  assert.equal(config.site.ownerName, 'SyntheticSite');
  assert.equal(config.theme.colors.accent, '#ff8800');
  assert.equal(config.content.manifestIdentifier, dependency.identifier);
  assert.ok(entries['index.html'], 'entrypoint is present');
  const validated = await validateHandoffPackage({ handoffDir: dir });
  assert.equal(validated.verified.length, manifest.resources.length);
  assert.ok(validated.verified.find((entry) => entry.id === site.id).bundle.verified >= 3);
  assert.equal(handoff.counts.site, 1);
});

test('the CMS can be hosted as WEBSITE under the same registered name', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1)],
    settings: { extra: { website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'Website service' } } }
  });
  await env.handle.source.discover({ perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const dir = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(dir, 'handoff.json'), 'utf8'));
  const site = manifest.resources.find((resource) => resource.kind === 'site');
  assert.equal(site.service, 'WEBSITE');
  assert.equal(site.name, 'SyntheticSite');
  assert.equal(site.metadata.service, 'WEBSITE');
  assert.equal(manifest.resources.filter((resource) => resource.service === 'WEBSITE').length, 1);
  await validateHandoffPackage({ handoffDir: dir });
});

test('APP and WEBSITE application bundles may share one registered name', async (t) => {
  const { manifest } = await prepareSite(t);
  const site = manifest.resources.find((resource) => resource.kind === 'site');
  const clone = structuredClone(manifest);
  const website = structuredClone(site);
  website.id = 'res_websitedemo0001';
  website.service = 'WEBSITE';
  website.identifier = 'qms-nsaaaaaaaa-web-generic-cms-demo0001';
  website.metadata = { ...website.metadata, service: 'WEBSITE' };
  clone.resources.push(website);
  clone.estimate.resourceCount = clone.resources.length;
  assert.doesNotThrow(() => assertHandoffManifest(sealDocument(clone)));
  const triples = new Set(clone.resources.map((resource) => resource.service + '|' + resource.name + '|' + resource.identifier));
  assert.equal(triples.size, clone.resources.length);
  assert.ok([...triples].some((triple) => triple.startsWith('APP|SyntheticSite|')));
  assert.ok([...triples].some((triple) => triple.startsWith('WEBSITE|SyntheticSite|')));
});

test('a tampered CMS bundle is rejected before publication', async (t) => {
  const { dir, manifest } = await prepareSite(t);
  const site = manifest.resources.find((resource) => resource.kind === 'site');
  const target = path.join(dir, site.relativePath);
  const original = await readFile(target);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 30] ^= 0xff;
  await writeFile(target, tampered);
  await assert.rejects(
    () => validateHandoffPackage({ handoffDir: dir }),
    (error) => ['PUBLICATION_PACKAGE_CORRUPT', 'PUBLICATION_HASH_MISMATCH'].includes(error.code)
  );
});

test('the desktop exports a single Publisher ZIP with handoff.json at its root', async (t) => {
  const { env, handoff } = await prepareSite(t);
  const exported = await env.handle.publication.exportBundle(handoff.handoffId);
  const zip = await readFile(exported.absolutePath);
  assert.equal(zip.length, exported.bytes);
  assert.equal(sha256Bytes(zip), exported.sha256);
  const entries = unzipSync(zip);
  assert.ok(entries['handoff.json']);
  assert.ok(entries['README.txt']);
  const manifest = JSON.parse(new TextDecoder().decode(entries['handoff.json']));
  assert.equal(manifest.handoffId, handoff.handoffId);
  assert.ok(Object.keys(entries).some((entry) => entry.endsWith('.zip')), 'CMS bundle travels inside the package');
});

test('APP exact read-back verifies every member through filepath base64', async () => {
  const members = [
    { path: 'index.html', bytes: Buffer.from('<html>ok</html>') },
    { path: 'assets/app.js', bytes: Buffer.from('console.log(1)') }
  ];
  const resource = {
    id: 'res_site',
    service: 'APP',
    name: 'Site Name',
    identifier: 'qms-site',
    bytes: 1,
    sha256: 'sha256:' + '0'.repeat(64),
    metadata: {
      bundle: {
        schema: 'qms-cms-bundle@1',
        format: 'zip',
        entrypoint: 'index.html',
        files: members.map((member) => ({ path: member.path, bytes: member.bytes.length, sha256: sha256Bytes(member.bytes) }))
      }
    }
  };
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    const filepath = parsed.searchParams.get('filepath');
    const member = members.find((entry) => entry.path === filepath);
    if (!member) return { status: 404, ok: false, text: async () => '' };
    return { status: 200, ok: true, text: async () => member.bytes.toString('base64') };
  };
  const result = await verifyResourceOnce({ fetchImpl: fakeFetch, nodeUrl: 'http://node.local', resource });
  assert.equal(result.state, 'remote_verified');
  assert.equal(result.evidence.members.length, 2);
  assert.ok(requested.every((url) => url.includes('encoding=base64') && url.includes('filepath=')));
  assert.ok(requested.some((url) => url.includes('filepath=assets/app.js')));

  const mismatch = structuredClone(resource);
  mismatch.metadata.bundle.files[0].sha256 = 'sha256:' + '1'.repeat(64);
  const failed = await verifyResourceOnce({ fetchImpl: fakeFetch, nodeUrl: 'http://node.local', resource: mismatch });
  assert.equal(failed.state, 'ambiguous');
  assert.equal(failed.code, 'READBACK_MISMATCH');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';
import { sealDocument } from '../../lib/engine/publication/handoff.js';
import { buildFolderMapFromZip, validateHandoffPackage } from '../../viewer/src/publisher/handoff.ts';

async function packageZip(root) {
  const entries = {};
  const mtime = new Date('1980-01-01T00:00:00.000Z');
  const walk = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) entries[relative] = [new Uint8Array(await readFile(absolute)), { level: 6, mtime }];
    }
  };
  await walk(root);
  return Buffer.from(zipSync(entries, { level: 6, mtime }));
}

test('the Publisher imports an exported .zip, validates the CMS APP bundle and rejects tampering', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1)],
    settings: { extra: { website: { cms: 'generic-cms', tagline: 'Publisher package test' } } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);

  const zip = await packageZip(root);
  const map = await buildFolderMapFromZip(new File([zip], 'handoff.zip', { type: 'application/zip' }));
  const validated = await validateHandoffPackage(map);
  assert.equal(validated.summary.resources, validated.manifest.resources.length);
  assert.ok(validated.manifest.resources.some((resource) => resource.service === 'APP'));
  assert.equal(validated.manifest.cms.selection, 'generic-cms');
  assert.equal(validated.manifest.cms.delivery, 'included');
  const site = validated.manifest.resources.find((resource) => resource.kind === 'site');
  assert.ok(site.metadata.bundle.files.some((file) => file.path === 'qms-cms-config.json'));
  assert.equal(validated.summary.counts.site, 1);

  const manifest = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  const siteResource = manifest.resources.find((resource) => resource.kind === 'site');
  const sitePath = path.join(root, siteResource.relativePath);
  const original = await readFile(sitePath);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 20] ^= 0xff;
  await writeFile(sitePath, tampered);
  const badMap = await buildFolderMapFromZip(new File([await packageZip(root)], 'handoff.zip'));
  await assert.rejects(() => validateHandoffPackage(badMap), /SHA-256|byte length|ZIP/i);
});

test('the Publisher accepts an explicit Content only package and rejects CMS metadata mismatch', async (t) => {
  const env = await startPhase3(t, {
    posts: [makePost(1)],
    settings: { extra: { website: { cms: 'none' } } }
  });
  await env.handle.source.discover({ mode: 'full', perPage: 50 });
  const plan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  const selection = plan.plan.entries.filter((entry) => entry.status === 'new').map((entry) => entry.sourceKey);
  const handoff = await env.handle.publication.prepare({ planId: plan.planId, selection });
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const map = await buildFolderMapFromZip(new File([await packageZip(root)], 'handoff.zip'));
  const validated = await validateHandoffPackage(map);
  assert.equal(validated.manifest.cms.selection, 'content-only');
  assert.equal(validated.manifest.resources.some((resource) => resource.kind === 'site'), false);

  const invalid = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  invalid.cms = { ...invalid.cms, selection: 'generic-cms', delivery: 'included', service: 'APP', name: 'SyntheticSite', identifier: 'qms-invalid', resourceId: 'res_invalid' };
  const canonical = JSON.stringify(sealDocument(invalid));
  map.set('handoff.json', { ...map.get('handoff.json'), bytes: new TextEncoder().encode(canonical), file: new File([canonical], 'handoff.json') });
  await assert.rejects(() => validateHandoffPackage(map), /Generic CMS|CMS/i);
});

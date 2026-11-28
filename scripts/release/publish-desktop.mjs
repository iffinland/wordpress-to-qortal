#!/usr/bin/env node
// Independent promotion of owner-accepted bytes. The bundle gates are unchanged.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT, PRODUCT_SOURCE_PATHS, workingSourceDigest, sha256File } from './lib.mjs';
import { checkVersions } from '../qms-release.mjs';

const root = REPO_ROOT;
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const write = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const release = await read('qms-release.json');
const record = release.componentReleases.desktop;
const acceptance = await read('docs/migration-studio/evidence/DESKTOP-BETA.5-ACCEPTANCE.json');
const trial = acceptance.artifact;
const out = path.join(root, 'release/desktop');
const publish = process.argv.includes('--publish');
assert.equal((await checkVersions()).ok, true, 'Version markers must agree');
assert.equal(record.version, release.components.desktop.version);
assert.equal(record.tag, 'desktop-v' + record.version);
assert.equal(acceptance.ownerAcceptance.status, 'passed');
assert.equal(record.runtimeAcceptance.sha256, trial.sha256);
assert.equal(record.runtimeAcceptance.status, 'passed');
assert.equal(trial.version, record.version);
assert.equal(workingSourceDigest(root), trial.workingSourceSha256, 'Product source changed since owner acceptance');
assert.equal(acceptance.automatedEvidence.validation.sha256, trial.sha256);
assert.equal(acceptance.automatedEvidence.validation.failed, 0);
assert.equal(acceptance.automatedEvidence.security.verdict, 'pass');
assert.ok(acceptance.automatedEvidence.packagedAcceptance.every(item => item.passed));
await mkdir(out, { recursive: true });
const name = `qortal-migration-studio_${record.version}_amd64.deb`;
assert.equal(trial.artifact, name);
const artifact = path.join(out, name);
let sourceCommit = git(['rev-parse', 'HEAD']);
if (publish) {
  assert.equal(git(['status', '--porcelain']), '', 'Publish only from a clean committed checkout');
  const transfer = await read('.qms-desktop-transfer.json');
  sourceCommit = transfer.sourceCommit;
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, 'HEAD'], { cwd: root });
  execFileSync('git', ['diff', '--quiet', sourceCommit, 'HEAD', '--', ...PRODUCT_SOURCE_PATHS], { cwd: root });
  execFileSync('git', ['diff', '--quiet', trial.sourceCommit, sourceCommit, '--', 'viewer', 'templates', 'corbettreport'], { cwd: root });
  // The short-lived source grants read access only to the artifact being published.
  const sourceUrl = new URL(transfer.url);
  assert.equal(sourceUrl.protocol, 'https:');
  assert.match(sourceUrl.hostname, /^(?:sdmntpr[^.]*\.oaiusercontent\.com|[^.]+\.blob\.core\.windows\.net)$/);
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
  assert.equal(response.ok, true, 'Accepted artifact transfer failed');
  const zip = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(zip).digest('hex'), transfer.sha256, 'Transfer ZIP digest mismatch');
  const zipPath = path.join(out, 'accepted.zip');
  await writeFile(zipPath, zip);
  execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); data=z.read(sys.argv[2]); open(sys.argv[3],"wb").write(data)', zipPath, name, artifact]);
} else {
  await copyFile(path.join(root, 'desktop/release', name), artifact);
}
assert.equal(await sha256File(artifact), trial.sha256, 'DEB is not the exact owner-accepted artifact');
assert.equal((await stat(artifact)).size, trial.bytes);
assert.equal(execFileSync('dpkg-deb', ['-f', artifact, 'Version'], { encoding: 'utf8' }).trim(), record.version.replace(/-/g, '~'));
assert.equal(execFileSync('dpkg-deb', ['-f', artifact, 'Architecture'], { encoding: 'utf8' }).trim(), 'amd64');
const manifest = {
  schema: 'qms-component-release@1', component: 'desktop', version: record.version,
  tag: record.tag, source: { commit: sourceCommit, dirty: false, productSourceSha256: trial.workingSourceSha256 },
  artifact: { kind: 'deb', name, componentVersion: record.version, bytes: trial.bytes, sha256: trial.sha256 },
  runtimeAcceptance: record.runtimeAcceptance,
  build: { method: 'Promoted exact owner-accepted trial; not rebuilt', originalTrial: trial },
  unchangedComponents: { publisher: release.components.publisher.version, cms: release.components.cms.version }
};
await write(path.join(out, 'desktop-release-manifest.json'), manifest);
await write(path.join(root, 'release/desktop-release-manifest.json'), manifest);
await writeFile(path.join(out, 'SHA256SUMS'), `${trial.sha256}  ${name}\n`);
await copyFile(path.join(root, record.notes), path.join(out, 'RELEASE-NOTES.md'));
await write(path.join(out, 'original-trial-artifact.json'), trial);
await write(path.join(out, 'acceptance.json'), acceptance);
await write(path.join(out, 'validation.json'), acceptance.automatedEvidence.validation);
await write(path.join(out, 'security-report.json'), acceptance.automatedEvidence.security);
await write(path.join(out, 'provenance.intoto.json'), {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name, digest: { sha256: trial.sha256 } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: { buildDefinition: { buildType: 'qms/accepted-desktop-promotion', externalParameters: { runtimeAcceptance: record.runtimeAcceptance }, resolvedDependencies: [{ uri: `git+https://github.com/iffinland/wordpress-to-qortal.git@${sourceCommit}`, digest: { gitCommit: sourceCommit } }] }, runDetails: { builder: { id: 'qms-owner-accepted-artifact-promotion' }, metadata: { invocationId: process.env.GITHUB_RUN_ID || 'local-prepare' } }, originalTrialBuild: trial }
});
const engineLock = await read('desktop/engine-package/package-lock.json');
const desktopLock = await read('desktop/package-lock.json');
const components = Object.entries(engineLock.packages).filter(([key, value]) => key && value.version).map(([key, value]) => ({ type: 'library', name: key.replace(/^node_modules\//, ''), version: value.version, scope: 'required' }));
components.push({ type: 'framework', name: 'electron', version: desktopLock.packages['node_modules/electron'].version, scope: 'required' });
const cmsLock = await read('templates/generic-cms/package-lock.json');
for (const [key, value] of Object.entries(cmsLock.packages)) if (key && value.version && !value.dev) components.push({ type: 'library', name: key.replace(/^node_modules\//, ''), version: value.version, scope: 'required' });
await write(path.join(out, 'sbom.cdx.json'), { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { component: { type: 'application', name: 'Qortal Migration Studio', version: record.version, hashes: [{ alg: 'SHA-256', content: trial.sha256 }], properties: [{ name: 'qms:committedSource', value: sourceCommit }, { name: 'qms:originalTrialDirty', value: String(trial.dirty) }] } }, components });
if (publish) {
  const repo = 'iffinland/wordpress-to-qortal';
  const existing = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]));
  assert.equal(existing.some(item => item.tag_name === record.tag), false, 'Release already exists; never overwrite');
  assert.equal(git(['ls-remote', 'origin', `refs/tags/${record.tag}`]), '', 'Tag already exists; never reuse');
  const assets = [name, 'SHA256SUMS', 'RELEASE-NOTES.md', 'desktop-release-manifest.json', 'original-trial-artifact.json', 'acceptance.json', 'validation.json', 'security-report.json', 'provenance.intoto.json', 'sbom.cdx.json'];
  gh(['release', 'create', record.tag, '--repo', repo, '--target', sourceCommit, '--title', `Qortal Migration Studio ${record.version} — guided project management and login fixes`, '--notes-file', path.join(out, 'RELEASE-NOTES.md'), '--prerelease', '--draft', ...assets.map(file => path.join(out, file))]);
  const draft = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${record.tag}`]));
  const uploaded = draft.assets.find(item => item.name === name);
  assert.ok(uploaded && uploaded.size === trial.bytes, 'Uploaded DEB size mismatch');
  const assetInfo = JSON.parse(gh(['api', `repos/${repo}/releases/assets/${uploaded.id}`]));
  assert.equal(assetInfo.digest, 'sha256:' + trial.sha256, 'GitHub asset digest mismatch');
  gh(['release', 'edit', record.tag, '--repo', repo, '--draft=false']);
  const downloads = [];
  for (const file of assets) {
    const url = `https://github.com/${repo}/releases/download/${record.tag}/${file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    assert.equal(response.status, 200, 'Public asset download failed: ' + file);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, await sha256File(path.join(out, file)), 'Published asset changed: ' + file);
    downloads.push({ name: file, url, bytes: bytes.length, sha256 });
  }
  await write(path.join(out, 'public-verification.json'), { schema: 'qms-desktop-public-verification@1', ok: true, tag: record.tag, sourceCommit, downloads });
  console.log(`Published and independently downloaded ${record.tag}; DEB SHA-256 ${trial.sha256}`);
} else console.log(`Desktop promotion prepared; accepted DEB SHA-256 ${trial.sha256}; no rebuild or test rerun`);

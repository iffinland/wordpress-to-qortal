#!/usr/bin/env node
/**
 * Publishes a QMS prerelease from the release manifest.
 *
 * The asset list is derived from release/release-manifest.json, never chosen by
 * hand, so a release cannot omit one of the three production artifacts. An
 * existing release for the tag is never overwritten. After upload, every public
 * asset URL is downloaded without authentication and hashed independently.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, readJson, sha256File, writeJson } from './lib.mjs';
import { REQUIRED_ARTIFACT_KINDS, releaseArtifactPaths } from './artifact-set.mjs';
import { releaseTag } from './three-artifact-gate.mjs';

const REPO = 'iffinland/wordpress-to-qortal';
const GH = process.env.GH_BIN || '/home/iffi/.local/bin/gh';
const args = new Set(process.argv.slice(2));
const tagArg = process.argv.find((value) => value.startsWith('--tag='))?.slice('--tag='.length) ?? null;
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const tag = tagArg ?? releaseTag(release);
const releaseDir = path.join(REPO_ROOT, 'release');
const manifest = await readJson(path.join(releaseDir, 'release-manifest.json'));

if (manifest.schema !== 'qms-release-artifacts@1' || manifest.ok !== true) {
  console.error('release manifest is missing or the three-artifact gate did not pass.');
  process.exit(1);
}
if (manifest.version !== release.version || manifest.tag !== tag) {
  console.error('release manifest version/tag does not match the requested release.');
  process.exit(1);
}
for (const kind of REQUIRED_ARTIFACT_KINDS) {
  const entry = manifest.artifacts.find((artifact) => artifact.kind === kind);
  if (!entry) {
    console.error('release manifest is missing required artifact: ' + kind);
    process.exit(1);
  }
  const file = releaseArtifactPaths(REPO_ROOT, release)[kind];
  if (await sha256File(file) !== entry.sha256) {
    console.error('artifact changed after release preparation: ' + entry.name);
    process.exit(1);
  }
}

function gh(ghArgs, options = {}) {
  const result = spawnSync(GH, ghArgs, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

const existing = gh(['release', 'view', tag, '--repo', REPO, '--json', 'tagName']);
if (existing.status === 0) {
  console.error('release ' + tag + ' already exists. Existing releases and assets are immutable; refusing to overwrite.');
  process.exit(1);
}

const notesPath = path.join(releaseDir, 'RELEASE-NOTES.md');
const sourceNotes = await readFile(path.join(REPO_ROOT, release.releaseNotes), 'utf8');
const table = [
  '## Release artifacts',
  '',
  '| Artifact | File | Size (bytes) | SHA-256 |',
  '| --- | --- | --- | --- |',
  ...manifest.artifacts.map((entry) => '| ' + entry.label + ' | `' + entry.name + '` | ' + entry.bytes + ' | `' + entry.sha256 + '` |'),
  '',
  'Download all three artifacts from this release. `SHA256SUMS` covers every required artifact,',
  '`sbom.cdx.json` records shipped components, and `provenance.intoto.json` records the source',
  'commit, build inputs and artifact digests.',
  '',
  ''
].join('\n');
await writeFile(notesPath, sourceNotes.replace(/^(# .*)$/m, '$1\n\n' + table) + '\n');
if (!sourceNotes.includes('<!-- qms-release-version: ' + release.version + ' -->')) {
  console.error('release notes version marker is missing.');
  process.exit(1);
}

const docs = [
  'docs/migration-studio/INSTALL-LINUX.md',
  'docs/migration-studio/PUBLISHER-QAPP-DEPLOYMENT.md',
  'docs/migration-studio/alpha/FIRST-RUN-GUIDE.md',
  'docs/migration-studio/alpha/MIGRATION-WALKTHROUGH.md',
  'docs/migration-studio/alpha/SYNC-AND-RECOVERY.md',
  'docs/migration-studio/alpha/SUPPORTED-CONTENT.md',
  'docs/migration-studio/alpha/KNOWN-ISSUES.md'
].map((relative) => path.join(REPO_ROOT, relative));

const assets = [
  ...manifest.artifacts.map((entry) => releaseArtifactPaths(REPO_ROOT, release)[entry.kind]),
  path.join(releaseDir, 'SHA256SUMS'),
  'desktop/release/sbom.cdx.json',
  'desktop/release/provenance.intoto.json',
  path.join(releaseDir, 'release-manifest.json'),
  notesPath,
  ...docs
].map((file) => (path.isAbsolute(file) ? file : path.join(REPO_ROOT, file)));

for (const asset of assets) {
  await readFile(asset);
}

const create = gh([
  'release', 'create', tag,
  '--repo', REPO,
  '--prerelease',
  '--verify-tag',
  '--title', release.product + ' ' + release.version + ' (unsigned alpha)',
  '--notes-file', notesPath,
  ...assets
], { stdio: 'inherit' });
if (create.status !== 0) {
  console.error('gh release create failed with status ' + create.status);
  process.exit(create.status ?? 1);
}

const base = 'https://github.com/' + REPO + '/releases/download/' + tag + '/';
const verifications = [];
let failed = false;
for (const entry of manifest.artifacts) {
  const url = base + entry.name;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    verifications.push({ name: entry.name, url, ok: false, status: response.status, error: 'HTTP ' + response.status });
    failed = true;
    continue;
  }
  const body = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(body).digest('hex');
  const ok = sha256 === entry.sha256 && body.length === entry.bytes;
  verifications.push({ name: entry.name, url, ok, status: response.status, bytes: body.length, expectedBytes: entry.bytes, sha256, expectedSha256: entry.sha256 });
  if (!ok) failed = true;
}

const sumsUrl = base + 'SHA256SUMS';
const sumsResponse = await fetch(sumsUrl, { redirect: 'follow' });
let sumsOk = false;
if (sumsResponse.ok) {
  const text = await sumsResponse.text();
  sumsOk = manifest.artifacts.every((entry) => text.split('\n').some((line) => line.endsWith('  ' + entry.name)));
}
if (!sumsOk) failed = true;

const report = {
  schema: 'qms-public-download-verification@1',
  tag,
  releaseUrl: 'https://github.com/' + REPO + '/releases/tag/' + tag,
  verifiedAt: new Date().toISOString(),
  artifacts: verifications,
  sumsUrl,
  sumsOk,
  ok: !failed
};
await writeJson(path.join(releaseDir, 'public-verification.json'), report);
if (failed) {
  console.error('public download verification FAILED; see release/public-verification.json');
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));

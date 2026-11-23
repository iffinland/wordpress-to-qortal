#!/usr/bin/env node
// Reuse unchanged public Q-Apps only after exact public manifest/hash checks.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT, readJson } from './lib.mjs';
import { componentVersion, releaseArtifactPaths } from './artifact-set.mjs';
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const previous = await readJson(path.join(REPO_ROOT, 'docs/migration-studio/PUBLISHED-RELEASE.json'));
const base = 'https://github.com/iffinland/wordpress-to-qortal/releases/download/' + previous.releaseTag + '/';
async function get(name) {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
const manifest = JSON.parse((await get('release-manifest.json')).toString());
const sums = (await get('SHA256SUMS')).toString();
const paths = releaseArtifactPaths(REPO_ROOT, release);
const evidence = [];
for (const kind of ['publisher', 'cms']) {
  if (componentVersion(previous, kind) !== componentVersion(release, kind)) throw new Error('Cannot reuse changed component: ' + kind);
  const name = path.basename(paths[kind]);
  const entry = manifest.artifacts.find((item) => item.kind === kind && item.name === name);
  if (!entry || !sums.split('\n').includes(entry.sha256 + '  ' + name)) throw new Error('Previous manifest/checksums disagree: ' + name);
  const bytes = await get(name);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('Public artifact changed: ' + name);
  await mkdir(path.dirname(paths[kind]), { recursive: true });
  await writeFile(paths[kind], bytes);
  evidence.push({ kind, name, sha256, bytes: bytes.length, reusedFrom: previous.releaseTag });
}
await writeFile(path.join(REPO_ROOT, 'release/reused-qapps.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

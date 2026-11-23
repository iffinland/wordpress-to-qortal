#!/usr/bin/env node
// Every component must link to its latest published asset and exact checksum.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { latestComponentAssets, parseChecksums, COMPONENT_PATTERNS } from './component-release.mjs';
const repo = process.env.QMS_REPO || 'iffinland/wordpress-to-qortal';
const gh = (args) => execFileSync(process.env.GH_BIN || 'gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const release = JSON.parse(readFileSync('qms-release.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');
const latest = latestComponentAssets(JSON.parse(gh(['api', 'repos/' + repo + '/releases?per_page=100'])));
const links = [...readme.matchAll(/https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/)\s]+)\/([^)\s]+)/g)].filter((item) => item[1] === repo);
const checks = [];
for (const [kind, { release: published, asset }] of Object.entries(latest)) {
  const expected = `https://github.com/${repo}/releases/download/${published.tag_name}/${asset.name}`;
  const actual = links.filter((item) => COMPONENT_PATTERNS[kind].test(item[3]));
  if (!actual.length || actual.some((item) => item[0] !== expected)) throw new Error(kind + ' README link must be ' + expected);
  const version = release.components[kind].version;
  const expectedName = kind === 'desktop' ? `qortal-migration-studio_${version}_amd64.deb` : `qortal-migration-${kind === 'cms' ? 'generic-cms' : 'publisher'}-v${version}.zip`;
  if (asset.name !== expectedName || asset.state !== 'uploaded') throw new Error(kind + ': wrong public version or incomplete asset');
  const sums = published.assets.find((item) => item.name === 'SHA256SUMS');
  if (!sums) throw new Error('Missing SHA256SUMS: ' + published.tag_name);
  const hashes = parseChecksums(gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${sums.id}`]));
  if (!hashes.has(asset.name)) throw new Error('Checksum missing for ' + asset.name);
  if (asset.digest && asset.digest !== 'sha256:' + hashes.get(asset.name)) throw new Error('GitHub digest does not match SHA256SUMS: ' + asset.name);
  checks.push({ kind, tag: published.tag_name, url: expected, sha256: hashes.get(asset.name) });
}
console.log(JSON.stringify({ schema: 'qms-readme-link-gate@2', ok: true, components: checks }, null, 2));

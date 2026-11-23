#!/usr/bin/env node
// Resolve the latest downloadable asset independently for each component.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { latestComponentAssets, COMPONENT_PATTERNS } from './component-release.mjs';
const repo = process.env.QMS_REPO || 'iffinland/wordpress-to-qortal';
const releases = JSON.parse(execFileSync(process.env.GH_BIN || 'gh', ['api', `repos/${repo}/releases?per_page=100`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const targets = latestComponentAssets(releases);
let readme = readFileSync('README.md', 'utf8');
for (const [kind, { release, asset }] of Object.entries(targets)) {
  readme = readme.replace(/https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/)\s]+)\/([^)\s]+)/g, (url, ownerRepo, tag, name) => ownerRepo === repo && COMPONENT_PATTERNS[kind].test(name) ? `https://github.com/${repo}/releases/download/${release.tag_name}/${asset.name}` : url);
  const oldNames = [...readme.matchAll(/\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)/g)];
  for (const [, label, url] of oldNames) if (url.endsWith('/' + asset.name) && COMPONENT_PATTERNS[kind].test(label)) readme = readme.replace('[' + label + '](' + url + ')', '[' + asset.name + '](' + url + ')');
}
writeFileSync('README.md', readme);
console.log('README asset links follow independently published component versions.');

#!/usr/bin/env node
/**
 * Rewrites the three prominent README download links (and the checksum/provenance
 * links) so they follow the newest non-draft release, keeping each component's own
 * filename. Intended to run after a successful publish, before the link gate.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = process.env.QMS_REPO || 'iffinland/wordpress-to-qortal';
const README = path.join(process.cwd(), 'README.md');
const PATTERNS = {
  desktop: /qortal-migration-studio_[^/)]+_amd64\.deb/g,
  publisher: /qortal-migration-publisher-[^/)]+\.zip/g,
  cms: /qortal-migration-generic-cms-[^/)]+\.zip/g
};

const releases = JSON.parse(execFileSync('gh', ['api', 'repos/' + REPO + '/releases?per_page=30'], { encoding: 'utf8' }))
  .filter((r) => !r.draft)
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
const latest = releases[0];
if (!latest) {
  console.error('SYNC_README_FAILED: no published releases');
  process.exit(1);
}

const assets = (latest.assets || []).map((a) => a.name);
const pick = (pattern) => assets.find((name) => pattern.test(name));
const targets = {};
for (const [key, pattern] of Object.entries(PATTERNS)) {
  const name = pick(pattern);
  if (!name) {
    console.error('SYNC_README_FAILED: ' + latest.tag_name + ' has no ' + key + ' asset');
    process.exit(1);
  }
  targets[key] = name;
}

let readme = readFileSync(README, 'utf8');
const before = readme;
// Replace any component asset link with the newest release's matching asset.
for (const [key, pattern] of Object.entries(PATTERNS)) {
  const urlPattern = new RegExp('https://github\\.com/' + REPO.replace('/', '\\/') + '/releases/download/[^/)]+/(' + pattern.source + ')', 'g');
  readme = readme.replace(urlPattern, 'https://github.com/' + REPO + '/releases/download/' + latest.tag_name + '/' + targets[key]);
}
// Auxiliary links follow the newest tag but keep their filenames.
readme = readme.replace(new RegExp('https://github\\.com/' + REPO.replace('/', '\\/') + '/releases/download/[^/)]+/(SHA256SUMS|sbom\\.cdx\\.json|provenance\\.intoto\\.json)', 'g'),
  'https://github.com/' + REPO + '/releases/download/' + latest.tag_name + '/$1');

if (readme !== before) {
  writeFileSync(README, readme);
  console.log('README updated to ' + latest.tag_name);
} else {
  console.log('README already at ' + latest.tag_name);
}

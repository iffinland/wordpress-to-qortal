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

// The visible text must follow the release too, not just the URLs.
const desktopVersion = (targets.desktop.match(/qortal-migration-studio_([^/]+)_amd64\.deb/) || [])[1];
if (desktopVersion) {
  // Link labels that name a component file.
  readme = readme.replace(/qortal-migration-studio_[0-9A-Za-z.~-]+_amd64\.deb/g, 'qortal-migration-studio_' + desktopVersion + '_amd64.deb');
  // Section heading: "## Download Qortal Migration Studio 0.8.0 alpha.N"
  readme = readme.replace(/(## Download Qortal Migration Studio [0-9.]+ )[0-9A-Za-z.~-]+/g, '$1' + desktopVersion.replace(/^0\.8\.0-/, ''));
  // Release page link.
  readme = readme.replace(/https:\/\/github\.com\/[^\s>]*\/releases\/tag\/v[0-9A-Za-z.~-]+/g, 'https://github.com/' + REPO + '/releases/tag/' + latest.tag_name);
  // "Version **0.8.0 alpha.N** is the latest published alpha"
  readme = readme.replace(/(Version \*\*[0-9.]+ )[0-9A-Za-z.~-]+(\*\* is the latest published alpha)/g, '$1' + desktopVersion.replace(/^0\.8\.0-/, '') + '$2');
  // apt install line.
  readme = readme.replace(/sudo apt install \.\/qortal-migration-studio_[0-9A-Za-z.~-]+_amd64\.deb/g, 'sudo apt install ./qortal-migration-studio_' + desktopVersion + '_amd64.deb');
}

if (readme !== before) {
  writeFileSync(README, readme);
  console.log('README updated to ' + latest.tag_name);
} else {
  console.log('README already at ' + latest.tag_name);
}

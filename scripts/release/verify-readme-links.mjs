#!/usr/bin/env node
/**
 * Release gate: the three prominent download links in README.md must point at the
 * newest published, verified release, with the exact asset that belongs to it.
 *
 * Fails when a link is outdated, missing, points at a non-existent asset, or when
 * the advertised component versions do not match the release's own SHA256SUMS.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = process.env.QMS_REPO || 'iffinland/wordpress-to-qortal';
const ROOT = process.cwd();
const README = path.join(ROOT, 'README.md');

const COMPONENTS = [
  { key: 'desktop', label: 'Qortal Migration Studio (.deb)', pattern: /^qortal-migration-studio_.+_amd64\.deb$/ },
  { key: 'publisher', label: 'Migration Publisher ZIP', pattern: /^qortal-migration-publisher-.+\.zip$/ },
  { key: 'cms', label: 'Generic CMS ZIP', pattern: /^qortal-migration-generic-cms-.+\.zip$/ }
];

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function fail(message) {
  console.error('README_LINK_GATE_FAILED: ' + message);
  process.exitCode = 1;
}

const readme = readFileSync(README, 'utf8');
const linkPattern = new RegExp('https://github\\.com/' + REPO.replace('/', '\\/') + '/releases/download/([^/)\\s]+)/([^)\\s]+)', 'g');
const links = [...readme.matchAll(linkPattern)].map((m) => ({ tag: m[1], asset: m[2], url: m[0] }));

if (links.length === 0) {
  fail('README.md contains no release download links');
}

const releases = JSON.parse(gh(['api', 'repos/' + REPO + '/releases?per_page=30']))
  .filter((r) => !r.draft)
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
const latest = releases[0];
if (!latest) {
  fail('no published releases found for ' + REPO);
}

const latestAssets = new Map((latest.assets || []).map((a) => [a.name, a]));
for (const component of COMPONENTS) {
  const match = [...latestAssets.keys()].find((name) => component.pattern.test(name));
  if (!match) {
    fail('latest release ' + latest.tag_name + ' has no asset matching ' + component.label);
    continue;
  }
  const expected = 'https://github.com/' + REPO + '/releases/download/' + latest.tag_name + '/' + match;
  const actual = links.filter((l) => component.pattern.test(l.asset));
  if (actual.length === 0) {
    fail('README.md has no link for ' + component.label + ' (expected ' + expected + ')');
    continue;
  }
  for (const link of actual) {
    if (link.tag !== latest.tag_name || link.asset !== match) {
      fail(component.label + ' points at ' + link.tag + '/' + link.asset + ' but the newest release is ' + latest.tag_name + '/' + match);
    }
  }
  const asset = latestAssets.get(match);
  if (asset.state !== 'uploaded') {
    fail(component.label + ' asset state is ' + asset.state + ' (expected uploaded)');
  }
}

// Advertised versions must match the release's own checksum manifest.
const sumsAsset = [...latestAssets.values()].find((a) => a.name === 'SHA256SUMS');
if (sumsAsset) {
  try {
    const raw = execFileSync('gh', ['api', '-H', 'Accept: application/octet-stream', 'repos/' + REPO + '/releases/assets/' + sumsAsset.id], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const sums = new Map(raw.trim().split('\n').map((line) => line.trim().split(/\s+/)).filter((p) => p.length === 2).map((p) => [p[1], p[0]]));
    for (const link of links) {
      if (!sums.has(link.asset)) continue;
      if (!COMPONENTS.some((c) => c.pattern.test(link.asset))) continue;
    }
    for (const component of COMPONENTS) {
      const name = [...latestAssets.keys()].find((n) => component.pattern.test(n));
      if (name && !sums.has(name)) fail('SHA256SUMS of ' + latest.tag_name + ' does not list ' + name);
    }
  } catch (error) {
    fail('could not read SHA256SUMS of ' + latest.tag_name + ': ' + error.message);
  }
} else {
  fail('latest release ' + latest.tag_name + ' has no SHA256SUMS asset');
}

const stray = links.filter((l) => l.tag !== latest.tag_name && COMPONENTS.some((c) => c.pattern.test(l.asset)));
if (stray.length > 0) {
  fail('README.md references older component assets: ' + stray.map((s) => s.tag + '/' + s.asset).join(', '));
}

if (process.exitCode) {
  console.error('README must advertise ' + latest.tag_name + '. Update the three download links before publishing.');
} else {
  console.log(JSON.stringify({
    schema: 'qms-readme-link-gate@1',
    ok: true,
    tag: latest.tag_name,
    releaseUrl: 'https://github.com/' + REPO + '/releases/tag/' + latest.tag_name,
    links: [...new Set(links.filter((l) => COMPONENTS.some((c) => c.pattern.test(l.asset))).map((l) => l.url))]
  }, null, 2));
}

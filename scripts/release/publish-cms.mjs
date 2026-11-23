#!/usr/bin/env node
// Independent CMS delivery. The three-artifact DEB/bundle gates stay unchanged.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import { inspectQappZip } from './artifact-set.mjs';
import { checkVersions } from '../qms-release.mjs';
import { parseChecksums } from './component-release.mjs';
const repo = 'iffinland/wordpress-to-qortal';
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const record = release.componentReleases?.cms;
const version = release.components.cms.version;
if (!record || record.version !== version || record.tag !== 'cms-v' + version) throw new Error('Missing or inconsistent independent CMS release descriptor.');
const name = 'qortal-migration-generic-cms-v' + version + '.zip';
const zip = path.join(REPO_ROOT, 'release', name);
const gh = (args) => execFileSync(process.env.GH_BIN || 'gh', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fetchBytes = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(url + ': HTTP ' + response.status); return Buffer.from(await response.arrayBuffer()); };
const git = gitInfo(REPO_ROOT);
if (git.dirty) throw new Error('CMS release requires a clean committed checkout.');
if (!(await checkVersions()).ok) throw new Error('Version marker checks failed.');
const checked = await inspectQappZip(zip, { kind: 'cms', version });
if (!checked.ok) throw new Error(checked.errors.join('\n'));
const sha256 = await sha256File(zip);
const bytes = (await readFile(zip)).length;
const notes = await readFile(path.join(REPO_ROOT, record.notes), 'utf8');
if (!notes.includes('CMS **' + version + '**')) throw new Error('CMS notes must name the exact current version.');
const out = path.join(REPO_ROOT, 'release/cms-public');
await mkdir(out, { recursive: true });
const manifestPath = path.join(REPO_ROOT, 'release/cms-release-manifest.json');

if (process.argv.includes('--prepare')) {
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]));
  if (releases.some((item) => item.tag_name === record.tag)) throw new Error('This CMS release already exists. Never overwrite assets.');
  try { gh(['api', `repos/${repo}/git/ref/tags/${record.tag}`]); throw new Error('CMS tag already exists.'); }
  catch (error) { if (!String(error.stderr || '').includes('404')) throw error; }
  const base = `https://github.com/${repo}/releases/download/${release.releaseTag}/`;
  const baselineBytes = await fetchBytes(base + 'release-manifest.json');
  const baseline = JSON.parse(baselineBytes.toString());
  if (!baseline.ok || baseline.tag !== release.releaseTag) throw new Error('Invalid baseline bundle manifest.');
  const unchangedPaths = ['desktop', 'lib', 'viewer', 'src', 'broker', 'patches', 'package.json', 'package-lock.json'];
  const changed = execFileSync('git', ['diff', '--name-only', baseline.source.commit, git.commit, '--', ...unchangedPaths], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (changed) throw new Error('CMS-only release changed Desktop/Publisher inputs:\n' + changed);
  const baselineSums = parseChecksums((await fetchBytes(base + 'SHA256SUMS')).toString());
  const unchanged = [];
  for (const kind of ['deb', 'publisher']) {
    const entry = baseline.artifacts.find((item) => item.kind === kind);
    const component = kind === 'deb' ? 'desktop' : 'publisher';
    if (!entry || entry.componentVersion !== release.components[component].version || baselineSums.get(entry.name) !== entry.sha256) throw new Error('Baseline version/checksum mismatch: ' + kind);
    const publicBytes = await fetchBytes(base + entry.name);
    if (publicBytes.length !== entry.bytes || hash(publicBytes) !== entry.sha256) throw new Error('Existing public artifact failed verification: ' + entry.name);
    unchanged.push({ kind, name: entry.name, sha256: entry.sha256, bytes: entry.bytes, tag: release.releaseTag });
  }
  await writeFile(path.join(REPO_ROOT, 'release/release-manifest.json'), baselineBytes);
  await writeJson(manifestPath, { schema: 'qms-component-release@1', component: 'cms', version, tag: record.tag, source: git, artifact: { kind: 'cms', name, bytes, sha256, componentVersion: version }, unchanged, checks: checked.checks, preparedAt: new Date().toISOString() });
  await writeFile(path.join(out, 'SHA256SUMS'), sha256 + '  ' + name + '\n');
  console.log('CMS prepared; existing DEB and Publisher bytes verified, no DEB built.');
} else if (process.argv.includes('--publish')) {
  const manifest = await readJson(manifestPath);
  if (manifest.source.commit !== git.commit || manifest.artifact.sha256 !== sha256 || manifest.tag !== record.tag || manifest.artifact.bytes !== bytes) throw new Error('CMS changed after preparation.');
  // Strict docs and independent metadata must agree before creating an immutable tag.
  execFileSync(process.execPath, ['scripts/release/verify-active-docs.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  execFileSync('git', ['tag', record.tag, git.commit], { cwd: REPO_ROOT });
  execFileSync('git', ['push', 'origin', 'refs/tags/' + record.tag], { cwd: REPO_ROOT, stdio: 'inherit' });
  gh(['release', 'create', record.tag, '--repo', repo, '--prerelease', '--verify-tag', '--title', 'Generic CMS ' + version + ' — post quick actions', '--notes-file', path.join(REPO_ROOT, record.notes), zip, path.join(out, 'SHA256SUMS'), manifestPath, path.join(REPO_ROOT, record.notes), path.join(REPO_ROOT, 'docs/migration-studio/GENERIC-CMS-USER-MANUAL.md')]);
  const url = `https://github.com/${repo}/releases/download/${record.tag}/`;
  const downloaded = await fetchBytes(url + name);
  if (hash(downloaded) !== sha256 || downloaded.length !== bytes) throw new Error('Published CMS bytes failed independent download verification.');
  const sums = parseChecksums((await fetchBytes(url + 'SHA256SUMS')).toString());
  if (sums.get(name) !== sha256) throw new Error('Published CMS checksums disagree.');
  const publicManifest = JSON.parse((await fetchBytes(url + 'cms-release-manifest.json')).toString());
  if (publicManifest.source.commit !== git.commit || publicManifest.artifact.sha256 !== sha256) throw new Error('Published CMS provenance mismatch.');
  await writeJson(path.join(REPO_ROOT, 'release/cms-public-verification.json'), { schema: 'qms-component-public-verification@1', ok: true, tag: record.tag, sourceCommit: git.commit, url: url + name, bytes, sha256, unchanged: manifest.unchanged, verifiedAt: new Date().toISOString() });
  console.log('Published and publicly hash-verified ' + url + name);
} else throw new Error('Choose --prepare or --publish.');

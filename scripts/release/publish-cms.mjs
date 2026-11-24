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
if (record.runtimeAcceptance?.status !== 'passed' || record.runtimeAcceptance.sha256 !== sha256) throw new Error('CMS ZIP differs from the runtime-approved artifact.');
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
  const unchangedPaths = ['desktop', 'lib', 'src', 'broker', 'patches', 'package.json'];
  const changed = execFileSync('git', ['diff', '--name-only', baseline.source.commit, git.commit, '--', ...unchangedPaths], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (changed) throw new Error('CMS-only release changed Desktop/Publisher inputs:\n' + changed);
  // Publisher has its own accepted release; the original bundle still lists beta.1.
  const publisherRecord = release.componentReleases.publisher;
  const publisherBase = `https://github.com/${repo}/releases/download/${publisherRecord.tag}/`;
  const publisherBytes = await fetchBytes(publisherBase + 'publisher-release-manifest.json');
  const publisherManifest = JSON.parse(publisherBytes);
  const publisher = publisherManifest.artifact;
  if (publisherManifest.tag !== publisherRecord.tag || publisherManifest.version !== release.components.publisher.version || publisher.componentVersion !== release.components.publisher.version) throw new Error('Published Publisher manifest/version mismatch.');
  const publisherChanged = execFileSync('git', ['diff', '--name-only', publisherManifest.source.commit, git.commit, '--', 'viewer'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (publisherChanged) throw new Error('CMS-only release changed Publisher inputs:\n' + publisherChanged);
  const oldLock = JSON.parse(execFileSync('git', ['show', baseline.source.commit + ':package-lock.json'], { cwd: REPO_ROOT, encoding: 'utf8' }));
  const newLock = await readJson(path.join(REPO_ROOT, 'package-lock.json'));
  for (const lock of [oldLock, newLock]) delete lock.packages.viewer.version;
  if (JSON.stringify(oldLock) !== JSON.stringify(newLock)) throw new Error('CMS-only release changed shared dependencies.');
  const baselineSums = parseChecksums((await fetchBytes(base + 'SHA256SUMS')).toString());
  const publisherSums = parseChecksums((await fetchBytes(publisherBase + 'SHA256SUMS')).toString());
  const unchanged = [];
  for (const kind of ['deb', 'publisher']) {
    const entry = kind === 'publisher' ? publisher : baseline.artifacts.find((item) => item.kind === kind);
    const component = kind === 'deb' ? 'desktop' : 'publisher';
    const sums = kind === 'publisher' ? publisherSums : baselineSums;
    const artifactBase = kind === 'publisher' ? publisherBase : base;
    const tag = kind === 'publisher' ? publisherRecord.tag : release.releaseTag;
    if (!entry || entry.componentVersion !== release.components[component].version || sums.get(entry.name) !== entry.sha256) throw new Error('Published version/checksum mismatch: ' + kind);
    const publicBytes = await fetchBytes(artifactBase + entry.name);
    if (publicBytes.length !== entry.bytes || hash(publicBytes) !== entry.sha256) throw new Error('Existing public artifact failed verification: ' + entry.name);
    unchanged.push({ kind, name: entry.name, sha256: entry.sha256, bytes: entry.bytes, tag });
  }
  await writeFile(path.join(REPO_ROOT, 'release/publisher-release-manifest.json'), publisherBytes);
  await writeFile(path.join(REPO_ROOT, 'release/release-manifest.json'), baselineBytes);
  await writeJson(manifestPath, { schema: 'qms-component-release@1', component: 'cms', version, tag: record.tag, source: git, artifact: { kind: 'cms', name, bytes, sha256, componentVersion: version }, unchanged, runtimeAcceptance: record.runtimeAcceptance, checks: checked.checks, preparedAt: new Date().toISOString() });
  await writeFile(path.join(out, 'SHA256SUMS'), sha256 + '  ' + name + '\n');
  console.log('CMS prepared; existing DEB and Publisher bytes verified, no DEB built.');
} else if (process.argv.includes('--publish')) {
  const manifest = await readJson(manifestPath);
  if (manifest.source.commit !== git.commit || manifest.artifact.sha256 !== sha256 || manifest.tag !== record.tag || manifest.artifact.bytes !== bytes) throw new Error('CMS changed after preparation.');
  // Strict docs and independent metadata must agree before creating an immutable tag.
  execFileSync(process.execPath, ['scripts/release/verify-active-docs.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  execFileSync('git', ['tag', record.tag, git.commit], { cwd: REPO_ROOT });
  execFileSync('git', ['push', 'origin', 'refs/tags/' + record.tag], { cwd: REPO_ROOT, stdio: 'inherit' });
  gh(['release', 'create', record.tag, '--repo', repo, '--prerelease', '--verify-tag', '--title', record.title || ('Generic CMS ' + version + ' — independent content connection'), '--notes-file', path.join(REPO_ROOT, record.notes), zip, path.join(out, 'SHA256SUMS'), manifestPath, path.join(REPO_ROOT, record.notes), path.join(REPO_ROOT, 'docs/migration-studio/GENERIC-CMS-USER-MANUAL.md')]);
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

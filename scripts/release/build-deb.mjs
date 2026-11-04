#!/usr/bin/env node
/**
 * Deterministic Debian package builder for Qortal Migration Studio.
 *
 * Electron Builder produces the unpacked runtime; this script owns the final
 * package layout, metadata, maintainer scripts, permissions and timestamps.
 * Nothing in this script deletes user project data on install, upgrade or
 * removal; project data lives under XDG_DATA_HOME, never under /opt.
 */
import { cp, mkdir, readFile, rm, stat, symlink, utimes, writeFile, readdir, lstat } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { REPO_ROOT, artifactName, fileModeFor, gitInfo, readJson, run, sha256File, sourceDateEpoch, walkFiles, writeJson, debVersion } from './lib.mjs';
import { checkVersions } from '../qms-release.mjs';

const args = new Set(process.argv.slice(2));
const allowDirty = args.has('--allow-dirty');
const skipBuild = args.has('--skip-build');

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopPackage = await readJson(path.join(REPO_ROOT, 'desktop/package.json'));

const versions = await checkVersions(REPO_ROOT);
if (!versions.ok) {
  console.error('Release version is inconsistent:');
  for (const failure of versions.failures) console.error(' - ' + failure);
  process.exit(1);
}
if (desktopPackage.version !== release.version) {
  console.error('desktop/package.json version does not match qms-release.json');
  process.exit(1);
}
if (release.architecture !== 'amd64') {
  console.error('Only amd64 packaging is currently supported.');
  process.exit(1);
}
if (config.schema !== 'qms-deb-release@1') {
  console.error('desktop/release.config.json must use schema qms-deb-release@1.');
  process.exit(1);
}

const git = gitInfo(REPO_ROOT);
if (git.dirty && !allowDirty) {
  console.error('Refusing a release build from a dirty worktree. Commit first or pass --allow-dirty for a local test build.');
  process.exit(1);
}
const epoch = sourceDateEpoch(git);
const releaseDir = path.join(REPO_ROOT, 'desktop/release');
const unpacked = path.join(releaseDir, 'linux-unpacked');
const stage = path.join(releaseDir, 'deb-stage');
const artifact = path.join(releaseDir, artifactName(config.packageName, release.version, release.architecture));

if (!skipBuild) {
  console.log('[1/6] building generic CMS template');
  run('npm', ['--prefix', 'templates/generic-cms', 'run', 'build'], { cwd: REPO_ROOT });
  console.log('[2/6] building desktop renderer and main process');
  run('npm', ['--prefix', 'desktop', 'run', 'build'], { cwd: REPO_ROOT });
  console.log('[3/6] staging engine runtime with locked dependencies');
  run('npm', ['--prefix', 'desktop', 'run', 'prepare:engine'], { cwd: REPO_ROOT });
  console.log('[4/6] building unpacked Electron application');
  run(path.join(REPO_ROOT, 'desktop/node_modules/.bin/electron-builder'), ['--linux', 'dir'], {
    cwd: path.join(REPO_ROOT, 'desktop'),
    env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch) }
  });
} else {
  console.log('[1-4/6] reusing existing build outputs (--skip-build)');
}

for (const required of [
  path.join(unpacked, config.executableName),
  path.join(unpacked, 'resources/app.asar'),
  path.join(unpacked, 'resources/engine/bin/qms-host.js'),
  path.join(unpacked, 'resources/engine/templates/generic-cms/dist/index.html'),
  path.join(unpacked, 'resources/engine/engine-runtime.json')
]) {
  try {
    await stat(required);
  } catch {
    throw new Error('unpacked application is missing required file: ' + required);
  }
}

console.log('[5/6] assembling deterministic package tree');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const installRoot = config.installationRoot.replace(/^\//, '');
const appStage = path.join(stage, installRoot);
await cp(unpacked, appStage, { recursive: true, verbatimSymlinks: true });

const iconsRoot = path.join(REPO_ROOT, 'desktop/build/icons');
for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
  const source = path.join(iconsRoot, size + '.png');
  const target = path.join(stage, 'usr/share/icons/hicolor', size, 'apps', config.packageName + '.png');
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

const desktopEntry = [
  '[Desktop Entry]',
  'Type=Application',
  'Version=1.0',
  'Name=' + config.productName,
  'Comment=Prepare, hand off and verify WordPress-to-QDN migrations',
  'Exec=' + config.installationRoot + '/' + config.executableName + ' %U',
  'Icon=' + config.packageName,
  'Terminal=false',
  'Categories=' + config.categories,
  'Keywords=' + config.keywords,
  'StartupNotify=true',
  'StartupWMClass=' + config.productName,
  'X-GNOME-UsesNotifications=true',
  ''
].join('\n');
const applicationsDir = path.join(stage, 'usr/share/applications');
await mkdir(applicationsDir, { recursive: true });
await writeFile(path.join(applicationsDir, config.packageName + '.desktop'), desktopEntry, { mode: 0o644 });

const docDir = path.join(stage, 'usr/share/doc', config.packageName);
await mkdir(docDir, { recursive: true });
const copyright = [
  'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
  'Upstream-Name: ' + config.productName,
  'Source: ' + config.homepage,
  '',
  'Files: *',
  'Copyright: 2026 ' + config.productName + ' contributors',
  'License: MIT',
  ' Permission is hereby granted, free of charge, to any person obtaining a copy',
  ' of this software and associated documentation files (the "Software"), to deal',
  ' in the Software without restriction, including without limitation the rights',
  ' to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  ' copies of the Software, and to permit persons to whom the Software is',
  ' furnished to do so, subject to the following conditions:',
  ' .',
  ' The above copyright notice and this permission notice shall be included in all',
  ' copies or substantial portions of the Software.',
  ' .',
  ' THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  ' IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  ' FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  ' AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  ' LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  ' OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  ' SOFTWARE.',
  ''
].join('\n');
await writeFile(path.join(docDir, 'copyright'), copyright, { mode: 0o644 });
await writeFile(path.join(docDir, 'README.Debian'), [
  config.productName + ' for Debian-based Linux',
  '',
  'Project data is stored under $XDG_DATA_HOME/' + config.packageName,
  '(default: ~/.local/share/' + config.packageName + ').',
  'Desktop configuration is stored under the XDG config directory.',
  '',
  'This package does not delete project data on removal or upgrade.',
  'Uninstalling the application leaves migrated and prepared project data intact.',
  ''
].join('\n'), { mode: 0o644 });

const debianDir = path.join(stage, 'DEBIAN');
await mkdir(debianDir, { recursive: true });
await writeFile(path.join(debianDir, 'postinst'), [
  '#!/bin/sh',
  'set -e',
  'if [ "$1" = configure ] && command -v update-desktop-database >/dev/null 2>&1; then',
  '  update-desktop-database -q /usr/share/applications || true',
  'fi',
  'if [ "$1" = configure ] && command -v gtk-update-icon-cache >/dev/null 2>&1; then',
  '  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true',
  'fi',
  'exit 0',
  ''
].join('\n'), { mode: 0o755 });
await writeFile(path.join(debianDir, 'prerm'), [
  '#!/bin/sh',
  'set -e',
  '# Project data under XDG_DATA_HOME is intentionally never touched.',
  'exit 0',
  ''
].join('\n'), { mode: 0o755 });

const files = await walkFiles(stage, { skip: [debianDir] });
let installedBytes = 0;
for (const file of files) {
  const relative = file.relative;
  const mode = fileModeFor(relative, file.mode);
  chmodStaged(file.absolute, mode);
  installedBytes += file.bytes;
}
const installedKiB = Math.ceil(installedBytes / 1024);

const md5Lines = [];
for (const file of files) {
  const body = await readFile(file.absolute);
  md5Lines.push(createHash('md5').update(body).digest('hex') + '  ' + file.relative);
}
md5Lines.sort((a, b) => a.slice(34).localeCompare(b.slice(34)));
await writeFile(path.join(debianDir, 'md5sums'), md5Lines.join('\n') + '\n', { mode: 0o644 });

// chmodStaged is synchronous so the deterministic pass cannot interleave with
// the asynchronous file walk.
function chmodStaged(file, mode) { chmodSync(file, mode); }

const descriptionLines = wrapDescription(config.description, 78);
const control = [
  'Package: ' + config.packageName,
  'Version: ' + debVersion(release.version),
  'Section: ' + config.section,
  'Priority: ' + config.priority,
  'Architecture: ' + release.architecture,
  'Depends: ' + config.depends.join(', '),
  'Recommends: ' + config.recommends.join(', '),
  'Installed-Size: ' + installedKiB,
  'Maintainer: ' + config.maintainer,
  'Homepage: ' + config.homepage,
  'Description: ' + config.synopsis,
  ...descriptionLines.map((line) => ' ' + line),
  ''
].join('\n');
await writeFile(path.join(debianDir, 'control'), control, { mode: 0o644 });

// Normalize timestamps after all content is final.
const epochSeconds = epoch;
async function normalize(current) {
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children) {
    const absolute = path.join(current, child.name);
    if (child.isDirectory()) {
      await normalize(absolute);
      await utimes(absolute, epochSeconds, epochSeconds);
    } else if (child.isFile()) {
      await utimes(absolute, epochSeconds, epochSeconds);
    }
  }
}
await normalize(stage);
await utimes(stage, epochSeconds, epochSeconds);

const binLink = path.join(stage, 'usr/bin', config.executableName);
await mkdir(path.dirname(binLink), { recursive: true });
await symlink(path.join(config.installationRoot, config.executableName), binLink);
await lstat(binLink);

console.log('[6/6] building ' + path.basename(artifact));
await rm(artifact, { force: true });
run('dpkg-deb', [
  '--build',
  '--root-owner-group',
  '--uniform-compression',
  '-Zgzip',
  '-z6',
  stage,
  artifact
], { cwd: REPO_ROOT, env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch) } });

const info = await stat(artifact);
const sha256 = await sha256File(artifact);
const built = {
  schema: 'qms-deb-artifact@1',
  artifact: path.basename(artifact),
  path: artifact,
  bytes: info.size,
  sha256,
  version: release.version,
  debianVersion: debVersion(release.version),
  architecture: release.architecture,
  channel: release.channel,
  signing: release.signing,
  sourceCommit: git.commit,
  sourceTree: git.tree,
  branch: git.branch,
  dirty: git.dirty,
  sourceDateEpoch: epoch,
  builtAt: new Date().toISOString()
};
await writeJson(path.join(releaseDir, 'artifact.json'), built);
await writeFile(path.join(releaseDir, 'SHA256SUMS'), sha256 + '  ' + path.basename(artifact) + '\n', { mode: 0o644 });
console.log(JSON.stringify(built, null, 2));

function wrapDescription(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

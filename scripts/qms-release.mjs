#!/usr/bin/env node
/**
 * Canonical QMS release version. One descriptor, one version across the
 * desktop app, engine, Hub publisher app, CMS template and release notes.
 *
 * Usage:
 *   node scripts/qms-release.mjs show
 *   node scripts/qms-release.mjs check
 *   node scripts/qms-release.mjs sync
 *   node scripts/qms-release.mjs metadata --json
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_TARGETS = [
  { file: 'desktop/package.json', lock: 'desktop/package-lock.json', lockKey: null },
  { file: 'desktop/engine-package/package.json', lock: 'desktop/engine-package/package-lock.json', lockKey: null },
  { file: 'viewer/package.json', lock: 'package-lock.json', lockKey: 'viewer' },
  { file: 'templates/generic-cms/package.json', lock: 'templates/generic-cms/package-lock.json', lockKey: null }
];

const ENGINE_FILE = 'lib/engine/index.js';
const ENGINE_PATTERN = /export const ENGINE_VERSION = '([^']+)';/;
const DOC_MARKER = /<!-- qms-release-version: ([^ ]+) -->/;

export async function readRelease(root = REPO_ROOT) {
  const descriptor = JSON.parse(await readFile(path.join(root, 'qms-release.json'), 'utf8'));
  if (descriptor.schema !== 'qms-release@1') {
    throw new Error('qms-release.json must use schema qms-release@1.');
  }
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(descriptor.version)) {
    throw new Error('qms-release.json version is not a valid semantic version.');
  }
  if (!['alpha', 'beta', 'rc', 'stable'].includes(descriptor.channel)) {
    throw new Error('qms-release.json channel is invalid.');
  }
  if (!['unsigned', 'signed'].includes(descriptor.signing)) {
    throw new Error('qms-release.json signing status is invalid.');
  }
  return descriptor;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function collectVersions(root = REPO_ROOT) {
  const release = await readRelease(root);
  const entries = [];
  for (const target of PACKAGE_TARGETS) {
    const file = path.join(root, target.file);
    const pkg = await readJson(file);
    entries.push({
      kind: 'package',
      file: target.file,
      actual: String(pkg.version ?? ''),
      expected: release.version
    });
  }
  const engineSource = await readFile(path.join(root, ENGINE_FILE), 'utf8');
  const engineMatch = ENGINE_PATTERN.exec(engineSource);
  entries.push({
    kind: 'engine',
    file: ENGINE_FILE,
    actual: engineMatch ? engineMatch[1] : '',
    expected: release.version
  });
  const notesPath = path.join(root, release.releaseNotes);
  let docMatch = null;
  try {
    docMatch = DOC_MARKER.exec(await readFile(notesPath, 'utf8'));
  } catch {
    docMatch = null;
  }
  entries.push({
    kind: 'docs',
    file: release.releaseNotes,
    actual: docMatch ? docMatch[1] : '',
    expected: release.version
  });
  return { release, entries };
}

export async function checkVersions(root = REPO_ROOT) {
  const { release, entries } = await collectVersions(root);
  const failures = entries
    .filter((entry) => entry.actual !== entry.expected)
    .map((entry) => entry.file + ': expected ' + entry.expected + ', found ' + (entry.actual || '<missing>'));
  return { ok: failures.length === 0, release, entries, failures };
}

async function writePackageVersion(file, version) {
  const source = await readFile(file, 'utf8');
  const parsed = JSON.parse(source);
  if (parsed.version === version) return false;
  parsed.version = version;
  await writeFile(file, JSON.stringify(parsed, null, 2) + '\n');
  return true;
}

async function writeLockVersion(file, version, lockKey) {
  let parsed;
  try {
    parsed = await readJson(file);
  } catch {
    return false;
  }
  let changed = false;
  if (lockKey) {
    const workspace = parsed.packages?.[lockKey];
    if (workspace && workspace.version !== version) {
      workspace.version = version;
      changed = true;
    }
  } else {
    if (parsed.version !== version) {
      parsed.version = version;
      changed = true;
    }
    const rootPackage = parsed.packages?.[''];
    if (rootPackage && rootPackage.version !== version) {
      rootPackage.version = version;
      changed = true;
    }
  }
  if (changed) await writeFile(file, JSON.stringify(parsed, null, 2) + '\n');
  return changed;
}

export async function syncVersions(root = REPO_ROOT) {
  const release = await readRelease(root);
  const changed = [];
  for (const target of PACKAGE_TARGETS) {
    if (await writePackageVersion(path.join(root, target.file), release.version)) {
      changed.push(target.file);
    }
    if (target.lock && await writeLockVersion(path.join(root, target.lock), release.version, target.lockKey)) {
      changed.push(target.lock);
    }
  }
  const engineFile = path.join(root, ENGINE_FILE);
  const engineSource = await readFile(engineFile, 'utf8');
  if (!ENGINE_PATTERN.test(engineSource)) throw new Error('ENGINE_VERSION marker not found in ' + ENGINE_FILE);
  const nextEngine = engineSource.replace(ENGINE_PATTERN, "export const ENGINE_VERSION = '" + release.version + "';");
  if (nextEngine !== engineSource) {
    await writeFile(engineFile, nextEngine);
    changed.push(ENGINE_FILE);
  }
  const notesFile = path.join(root, release.releaseNotes);
  let notes;
  try {
    notes = await readFile(notesFile, 'utf8');
  } catch {
    notes = null;
  }
  if (notes !== null) {
    const nextNotes = DOC_MARKER.test(notes)
      ? notes.replace(DOC_MARKER, '<!-- qms-release-version: ' + release.version + ' -->')
      : notes.replace(/^(# .+)$/m, '$1\n\n<!-- qms-release-version: ' + release.version + ' -->');
    if (nextNotes !== notes) {
      await writeFile(notesFile, nextNotes);
      changed.push(release.releaseNotes);
    }
  }
  return { release, changed };
}

export async function releaseMetadata(root = REPO_ROOT) {
  const release = await readRelease(root);
  return {
    schema: 'qms-release-metadata@1',
    product: release.product,
    version: release.version,
    channel: release.channel,
    signing: release.signing,
    architecture: release.architecture,
    debianPackage: release.debianPackage
  };
}

async function main(argv) {
  const command = argv[2] ?? 'check';
  if (command === 'show') {
    const { release, entries } = await collectVersions();
    console.log(JSON.stringify({ release, entries }, null, 2));
    return;
  }
  if (command === 'check') {
    const result = await checkVersions();
    if (!result.ok) {
      console.error('release version mismatch:');
      for (const failure of result.failures) console.error(' - ' + failure);
      process.exitCode = 1;
      return;
    }
    console.log('release version ' + result.release.version + ' is consistent across ' + result.entries.length + ' markers');
    return;
  }
  if (command === 'sync') {
    const result = await syncVersions();
    console.log('synced release version ' + result.release.version + '; changed ' + (result.changed.length ? result.changed.join(', ') : 'nothing'));
    return;
  }
  if (command === 'metadata') {
    console.log(JSON.stringify(await releaseMetadata(), null, 2));
    return;
  }
  console.error('Unknown command: ' + command);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv);
}

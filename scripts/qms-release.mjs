#!/usr/bin/env node
/**
 * QMS release descriptor and independent component version model.
 *
 * (A) GitHub release bundle version: qms-release.json "version" + "releaseTag".
 * (B) desktop version: desktop/package.json, engine package and ENGINE_VERSION.
 * (C) Publisher Q-App version: viewer/package.json (build-time __PUBLISHER_VERSION__).
 * (D) CMS template version: templates/generic-cms/package.json (__CMS_TEMPLATE_VERSION__).
 *
 * Component versions are independent. A bundle release never forces a
 * component version change, and an unchanged component keeps its existing
 * artifact identity.
 *
 * Usage:
 *   node scripts/qms-release.mjs show
 *   node scripts/qms-release.mjs check
 *   node scripts/qms-release.mjs sync
 *   node scripts/qms-release.mjs set-component --component=cms --version=0.8.1-alpha.1
 *   node scripts/qms-release.mjs set-bundle --version=0.9.0-alpha.1
 *   node scripts/qms-release.mjs metadata --json
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUPPORTED_RELEASE_SCHEMAS = ['qms-release@1', 'qms-release@2'];
export const COMPONENT_IDS = ['desktop', 'publisher', 'cms'];

const PACKAGE_TARGETS = {
  desktop: [
    { file: 'desktop/package.json', lock: 'desktop/package-lock.json', lockKey: null },
    { file: 'desktop/engine-package/package.json', lock: 'desktop/engine-package/package-lock.json', lockKey: null }
  ],
  publisher: [
    { file: 'viewer/package.json', lock: 'package-lock.json', lockKey: 'viewer' }
  ],
  cms: [
    { file: 'templates/generic-cms/package.json', lock: 'templates/generic-cms/package-lock.json', lockKey: null }
  ]
};
const ENGINE_FILE = 'lib/engine/index.js';
const ENGINE_PATTERN = /export const ENGINE_VERSION = '([^']+)';/;
const DOC_MARKER = /<!-- qms-release-version: ([^ ]+) -->/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/i;
const CHANNELS = ['alpha', 'beta', 'rc', 'stable'];

function channelOfVersion(version) {
  const match = /^\d+\.\d+\.\d+(?:-([a-z]+)(?:\.[a-z0-9]+)*)?/i.exec(version);
  if (!match) return null;
  if (!match[1]) return 'stable';
  const channel = match[1].toLowerCase();
  return CHANNELS.includes(channel) ? channel : null;
}

function assertVersion(value, label) {
  if (typeof value !== 'string' || !SEMVER.test(value)) {
    throw new Error(label + ' is not a valid semantic version.');
  }
}

export async function readRelease(root = REPO_ROOT) {
  const descriptor = JSON.parse(await readFile(path.join(root, 'qms-release.json'), 'utf8'));
  if (!SUPPORTED_RELEASE_SCHEMAS.includes(descriptor.schema)) {
    throw new Error('qms-release.json must use schema qms-release@1 or qms-release@2.');
  }
  assertVersion(descriptor.version, 'qms-release.json version');
  if (!CHANNELS.includes(descriptor.channel)) {
    throw new Error('qms-release.json channel is invalid.');
  }
  if (!['unsigned', 'signed'].includes(descriptor.signing)) {
    throw new Error('qms-release.json signing status is invalid.');
  }

  let components;
  if (descriptor.schema === 'qms-release@1') {
    components = Object.fromEntries(COMPONENT_IDS.map((id) => [id, {
      version: descriptor.version,
      channel: descriptor.channel,
      source: id === 'publisher' ? 'viewer/package.json' : id === 'cms' ? 'templates/generic-cms/package.json' : 'desktop/package.json'
    }]));
  } else {
    if (!descriptor.components || typeof descriptor.components !== 'object' || Array.isArray(descriptor.components)) {
      throw new Error('qms-release.json components must be an object.');
    }
    const keys = Object.keys(descriptor.components).sort();
    if (keys.length !== COMPONENT_IDS.length || keys.some((key, index) => key !== [...COMPONENT_IDS].sort()[index])) {
      throw new Error('qms-release.json components must contain exactly desktop, publisher and cms.');
    }
    components = {};
    for (const id of COMPONENT_IDS) {
      const record = descriptor.components[id];
      if (!record || typeof record !== 'object') throw new Error('qms-release.json components.' + id + ' is invalid.');
      assertVersion(record.version, 'qms-release.json components.' + id + '.version');
      const implied = channelOfVersion(record.version);
      if (!implied) throw new Error('qms-release.json components.' + id + '.version must use alpha, beta, rc or a stable version.');
      if (record.channel !== implied) {
        throw new Error('qms-release.json components.' + id + '.channel must match the version prerelease (' + implied + ').');
      }
      if (record.changelog !== undefined && (typeof record.changelog !== 'string' || record.changelog.length === 0 || record.changelog.length > 2000)) {
        throw new Error('qms-release.json components.' + id + '.changelog is invalid.');
      }
      components[id] = {
        version: record.version,
        channel: record.channel,
        source: record.source ?? (id === 'publisher' ? 'viewer/package.json' : id === 'cms' ? 'templates/generic-cms/package.json' : 'desktop/package.json'),
        changelog: record.changelog ?? null
      };
    }
  }

  const releaseTag = descriptor.releaseTag ?? 'v' + descriptor.version + '-' + descriptor.channel + '.1';
  if (typeof releaseTag !== 'string' || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag)) {
    throw new Error('qms-release.json releaseTag is invalid.');
  }

  return {
    ...descriptor,
    components,
    componentVersions: Object.fromEntries(COMPONENT_IDS.map((id) => [id, components[id].version])),
    releaseTag,
    legacySchema: descriptor.schema === 'qms-release@1'
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function collectVersions(root = REPO_ROOT) {
  const release = await readRelease(root);
  const entries = [];
  for (const id of COMPONENT_IDS) {
    for (const target of PACKAGE_TARGETS[id]) {
      const file = path.join(root, target.file);
      const pkg = await readJson(file);
      entries.push({
        kind: 'package',
        component: id,
        file: target.file,
        actual: String(pkg.version ?? ''),
        expected: release.components[id].version
      });
    }
  }
  const engineSource = await readFile(path.join(root, ENGINE_FILE), 'utf8');
  const engineMatch = ENGINE_PATTERN.exec(engineSource);
  entries.push({
    kind: 'engine',
    component: 'desktop',
    file: ENGINE_FILE,
    actual: engineMatch ? engineMatch[1] : '',
    expected: release.components.desktop.version
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
    component: 'bundle',
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

export async function syncComponentVersion(root, componentId, version) {
  if (!COMPONENT_IDS.includes(componentId)) throw new Error('Unknown component: ' + componentId);
  const changed = [];
  for (const target of PACKAGE_TARGETS[componentId]) {
    if (await writePackageVersion(path.join(root, target.file), version)) changed.push(target.file);
    if (target.lock && await writeLockVersion(path.join(root, target.lock), version, target.lockKey)) changed.push(target.lock);
  }
  if (componentId === 'desktop') {
    const engineFile = path.join(root, ENGINE_FILE);
    const engineSource = await readFile(engineFile, 'utf8');
    if (!ENGINE_PATTERN.test(engineSource)) throw new Error('ENGINE_VERSION marker not found in ' + ENGINE_FILE);
    const nextEngine = engineSource.replace(ENGINE_PATTERN, "export const ENGINE_VERSION = '" + version + "';");
    if (nextEngine !== engineSource) {
      await writeFile(engineFile, nextEngine);
      changed.push(ENGINE_FILE);
    }
  }
  return changed;
}

async function updateDescriptor(root, mutate) {
  const file = path.join(root, 'qms-release.json');
  const descriptor = await readJson(file);
  const next = mutate(descriptor);
  await writeFile(file, JSON.stringify(next, null, 2) + '\n');
  if (next.releaseNotes) {
    const notesFile = path.join(root, next.releaseNotes);
    let notes;
    try {
      notes = await readFile(notesFile, 'utf8');
    } catch {
      notes = null;
    }
    if (notes !== null) {
      const marker = String(next.version);
      const nextNotes = DOC_MARKER.test(notes)
        ? notes.replace(DOC_MARKER, '<!-- qms-release-version: ' + marker + ' -->')
        : notes.replace(/^(# .+)$/m, '$1\n\n<!-- qms-release-version: ' + marker + ' -->');
      if (nextNotes !== notes) await writeFile(notesFile, nextNotes);
    }
  }
}

export async function setComponentVersion(root, componentId, version) {
  if (!COMPONENT_IDS.includes(componentId)) throw new Error('Unknown component: ' + componentId);
  assertVersion(version, 'component version');
  const channel = channelOfVersion(version);
  if (!channel) throw new Error('Component version must use alpha, beta, rc or be stable.');
  await updateDescriptor(root, (descriptor) => {
    if (descriptor.schema !== 'qms-release@2') {
      throw new Error('Independent component versions require qms-release@2.');
    }
    return {
      ...descriptor,
      components: {
        ...descriptor.components,
        [componentId]: { ...descriptor.components[componentId], version, channel }
      }
    };
  });
  return syncComponentVersion(root, componentId, version);
}

export async function setBundleVersion(root, version) {
  assertVersion(version, 'bundle version');
  const channel = channelOfVersion(version);
  if (!channel) throw new Error('Bundle version must use alpha, beta, rc or be stable.');
  await updateDescriptor(root, (descriptor) => {
    if (descriptor.schema !== 'qms-release@2') throw new Error('Bundle changes require qms-release@2.');
    const releaseTag = 'v' + version;
    return { ...descriptor, version, channel, releaseTag };
  });
}

export async function syncVersions(root = REPO_ROOT) {
  const release = await readRelease(root);
  const changed = [];
  for (const id of COMPONENT_IDS) {
    changed.push(...await syncComponentVersion(root, id, release.components[id].version));
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
    schema: 'qms-release-metadata@2',
    product: release.product,
    bundleVersion: release.version,
    releaseTag: release.releaseTag,
    channel: release.channel,
    signing: release.signing,
    architecture: release.architecture,
    debianPackage: release.debianPackage,
    components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, release.components[id].version]))
  };
}

async function main(argv) {
  const command = argv[2] ?? 'check';
  const option = (name) => argv.find((value) => value.startsWith('--' + name + '='))?.slice(name.length + 3) ?? null;
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
    console.log('bundle ' + result.release.version + ' (' + result.release.releaseTag + ') is consistent across ' + result.entries.length + ' markers');
    console.log('components: ' + COMPONENT_IDS.map((id) => id + '=' + result.release.components[id].version).join(', '));
    return;
  }
  if (command === 'sync') {
    const result = await syncVersions();
    console.log('synced component versions; changed ' + (result.changed.length ? result.changed.join(', ') : 'nothing'));
    return;
  }
  if (command === 'set-component') {
    const component = option('component');
    const version = option('version');
    if (!component || !version) throw new Error('set-component requires --component= and --version=.');
    const changed = await setComponentVersion(REPO_ROOT, component, version);
    console.log('set ' + component + ' to ' + version + '; changed ' + (changed.length ? changed.join(', ') : 'nothing'));
    return;
  }
  if (command === 'set-bundle') {
    const version = option('version');
    if (!version) throw new Error('set-bundle requires --version=.');
    await setBundleVersion(REPO_ROOT, version);
    console.log('set bundle to ' + version);
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

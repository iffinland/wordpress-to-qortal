#!/usr/bin/env node
/**
 * Mandatory three-artifact release gate.
 *
 * A QMS release is blocked unless the .deb, the Migration Publisher Q-App ZIP
 * and the Generic CMS Q-App ZIP are all present, valid, version-compatible and
 * recorded in SHA256SUMS. This script is the single authority for the release
 * artifact list; publishing consumes its manifest instead of selecting files
 * by hand.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import {
  ARTIFACT_COMPONENTS,
  ARTIFACT_LABELS,
  REQUIRED_ARTIFACT_KINDS,
  componentVersion,
  fileSize,
  inspectQappZip,
  releaseArtifactPaths
} from './artifact-set.mjs';

export const RELEASE_MANIFEST_SCHEMA = 'qms-release-artifacts@1';

export function releaseTag(release) {
  return release.releaseTag ?? ('v' + release.version + '-' + release.channel + '.1');
}

function requiredSchemas(kind) {
  if (kind === 'publisher') {
    return ['qms-publication-handoff@1', 'qms-publication-receipt@1', 'qms-cms-bundle@1'];
  }
  return ['qms-cms-template-config@1', 'qms-cms-manifest@1', 'qms-qdn-manifest@1'];
}

async function inspectDeb(repoRoot, release, expected) {
  const errors = [];
  const file = releaseArtifactPaths(repoRoot, release).deb;
  let bytes = 0;
  let sha256 = '';
  try {
    bytes = await fileSize(file);
    sha256 = await sha256File(file);
  } catch {
    return { ok: false, errors: ['Required artifact is missing: ' + path.basename(file)], name: path.basename(file), bytes: 0, sha256: '', files: [] };
  }
  if (path.basename(file) !== expected) errors.push('Debian artifact name does not match the release descriptor: ' + path.basename(file));
  if (bytes < 30 * 1024 * 1024) errors.push('Debian artifact is implausibly small: ' + bytes + ' bytes');
  let artifact = null;
  try {
    artifact = await readJson(path.join(repoRoot, 'desktop/release/artifact.json'));
  } catch {
    errors.push('Debian artifact metadata (desktop/release/artifact.json) is missing.');
  }
  if (artifact) {
    if (artifact.schema !== 'qms-deb-artifact@1') errors.push('Debian artifact metadata schema is unexpected.');
    const desktopVersion = componentVersion(release, 'deb');
    if (artifact.version !== desktopVersion) errors.push('Debian artifact version ' + artifact.version + ' does not match ' + desktopVersion + '.');
    if (artifact.sha256 !== sha256) errors.push('Debian artifact SHA-256 does not match its metadata.');
    if (artifact.bytes !== bytes) errors.push('Debian artifact size does not match its metadata.');
  }
  let validation = null;
  try {
    validation = await readJson(path.join(repoRoot, 'desktop/release/validation.json'));
  } catch {
    errors.push('Debian validation report (desktop/release/validation.json) is missing.');
  }
  if (validation) {
    if (validation.failed !== 0 || !(validation.checks > 0)) errors.push('Debian artifact validation did not pass.');
    if (validation.version && validation.version !== componentVersion(release, 'deb')) errors.push('Debian validation version does not match.');
  }
  return {
    ok: errors.length === 0,
    errors,
    name: path.basename(file),
    path: file,
    bytes,
    sha256,
    files: ['deb payload']
  };
}

async function inspectZip(repoRoot, release, kind) {
  const file = releaseArtifactPaths(repoRoot, release)[kind];
  try {
    await fileSize(file);
  } catch {
    return { ok: false, errors: ['Required artifact is missing: ' + path.basename(file)], name: path.basename(file), path: file, bytes: 0, sha256: '', files: [] };
  }
  const result = await inspectQappZip(file, { kind, version: componentVersion(release, kind) });
  const downloadBytes = await fileSize(file);
  return {
    ok: result.ok,
    errors: result.errors,
    name: path.basename(file),
    path: file,
    bytes: downloadBytes,
    uncompressedBytes: result.bytes,
    sha256: result.sha256,
    files: result.files
  };
}

export async function runThreeArtifactGate({ repoRoot = REPO_ROOT, release: releaseOverride = null, tag = null, write = true } = {}) {
  const release = releaseOverride ?? await readJson(path.join(repoRoot, 'qms-release.json'));
  const git = gitInfo(repoRoot);
  const expectedDeb = 'qortal-migration-studio_' + String(componentVersion(release, 'deb')).replace(/-/g, '~') + '_' + release.architecture + '.deb';
  const artifacts = {};
  const failures = [];

  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    const result = kind === 'deb'
      ? await inspectDeb(repoRoot, release, expectedDeb)
      : await inspectZip(repoRoot, release, kind);
    artifacts[kind] = result;
    for (const error of result.errors) failures.push(kind + ': ' + error);
  }

  const versions = Object.fromEntries(REQUIRED_ARTIFACT_KINDS.map((kind) => [kind, componentVersion(release, kind)]));
  const compatibilitySchemas = REQUIRED_ARTIFACT_KINDS.flatMap((kind) => requiredSchemas(kind));

  if (artifacts.deb.ok) {
    let artifact = null;
    try {
      artifact = await readJson(path.join(repoRoot, 'desktop/release/artifact.json'));
    } catch {
      artifact = null;
    }
    if (artifact) {
      if (artifact.sourceCommit !== git.commit) failures.push('deb: source commit ' + artifact.sourceCommit + ' does not match HEAD ' + git.commit + '.');
      if (artifact.dirty === true) failures.push('deb: artifact was built from a dirty worktree.');
    }
  }
  if (git.dirty) failures.push('release worktree is dirty; commit before preparing release artifacts.');

  const sumsLines = [];
  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    const artifact = artifacts[kind];
    if (artifact.sha256) sumsLines.push(artifact.sha256 + '  ' + artifact.name);
  }
  sumsLines.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));

  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    product: release.product,
    version: release.version,
    channel: release.channel,
    tag: tag ?? releaseTag(release),
    signing: release.signing,
    architecture: release.architecture,
    source: {
      commit: git.commit,
      tree: git.tree,
      branch: git.branch,
      dirty: git.dirty
    },
    artifacts: REQUIRED_ARTIFACT_KINDS.map((kind) => ({
      kind,
      component: ARTIFACT_COMPONENTS[kind],
      label: ARTIFACT_LABELS[kind],
      name: artifacts[kind].name,
      bytes: artifacts[kind].bytes,
      uncompressedBytes: artifacts[kind].uncompressedBytes ?? null,
      sha256: artifacts[kind].sha256,
      entrypoint: kind === 'deb' ? null : '/index.html',
      files: artifacts[kind].files.length,
      componentVersion: versions[kind],
      version: versions[kind],
      layout: kind === 'deb' ? 'debian-package' : 'qapp-root'
    })),
    compatibility: {
      versionedManifests: [...new Set(compatibilitySchemas)],
      publisherHandoff: artifacts.publisher.ok ? 'compatible' : 'blocked',
      cmsRuntimeConfig: artifacts.cms.ok ? 'compatible' : 'blocked'
    },
    sha256sums: sumsLines.map((line) => line.slice(66)).sort(),
    failures,
    ok: failures.length === 0,
    generatedAt: new Date().toISOString()
  };

  if (write && manifest.ok) {
    const releaseDir = path.join(repoRoot, 'release');
    await writeJson(path.join(releaseDir, 'release-manifest.json'), manifest);
    await writeFile(path.join(releaseDir, 'SHA256SUMS'), sumsLines.join('\n') + '\n');
  }

  return { ok: manifest.ok, failures, manifest, artifacts, release, git };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const tagArg = process.argv.find((value) => value.startsWith('--tag='))?.slice('--tag='.length) ?? null;
  const result = await runThreeArtifactGate({ tag: tagArg });
  if (!result.ok) {
    console.error('three-artifact release gate FAILED:');
    for (const failure of result.failures) console.error(' - ' + failure);
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    version: result.manifest.version,
    artifacts: result.manifest.artifacts.map((artifact) => ({ name: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 }))
  }, null, 2));
}

#!/usr/bin/env node
/**
 * Build provenance for the .deb artifact (in-toto Statement v1, SLSA v1
 * predicate shape). This records the exact source commit, tree, lockfiles,
 * toolchain and artifact digest. It is unsigned build evidence, not a
 * signature and not a claim of a hosted CI builder.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, artifactName, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopVersion = componentVersion(release, 'desktop');
const artifact = path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, desktopVersion, release.architecture));
const git = gitInfo(REPO_ROOT);
const artifactSha = await sha256File(artifact);
const artifactInfo = await readJson(path.join(REPO_ROOT, 'desktop/release/artifact.json')).catch(() => null);
const releaseManifest = await readJson(path.join(REPO_ROOT, 'release/release-manifest.json')).catch(() => null);
if (!releaseManifest || releaseManifest.schema !== 'qms-release-artifacts@1' || releaseManifest.artifacts?.length !== 3) {
  console.error('three-artifact release manifest is missing or incomplete; run the release gate first.');
  process.exit(1);
}
const manifestArtifacts = [];
for (const entry of releaseManifest.artifacts) {
  const absolute = entry.kind === 'deb' ? artifact : path.join(REPO_ROOT, 'release', entry.name);
  const actualSha = await sha256File(absolute);
  if (actualSha !== entry.sha256) {
    console.error('artifact changed after the release gate: ' + entry.name);
    process.exit(1);
  }
  manifestArtifacts.push({ ...entry, path: absolute, sha256: actualSha });
}
const validation = await readJson(path.join(REPO_ROOT, 'desktop/release/validation.json', )).catch(() => null);

const inputFiles = [
  'qms-release.json',
  'package.json',
  'package-lock.json',
  'desktop/package.json',
  'desktop/package-lock.json',
  'desktop/release.config.json',
  'desktop/electron-builder.yml',
  'desktop/engine-package/package.json',
  'desktop/engine-package/package-lock.json',
  'templates/generic-cms/package.json',
  'templates/generic-cms/package-lock.json',
  'lib/engine/index.js',
  'bin/qms-host.js'
];
const resolvedDependencies = [];
for (const relative of inputFiles) {
  const absolute = path.join(REPO_ROOT, relative);
  const body = await readFile(absolute);
  resolvedDependencies.push({
    uri: 'file://' + relative,
    digest: { sha256: createHash('sha256').update(body).digest('hex') }
  });
}
resolvedDependencies.push({
  uri: 'git+https://github.com/iffinland/wordpress-to-qortal.git@' + git.commit,
  digest: { gitCommit: git.commit }
});

const electronPackage = await readJson(path.join(REPO_ROOT, 'desktop/node_modules/electron/package.json'));
const epoch = Number(process.env.SOURCE_DATE_EPOCH) || artifactInfo?.sourceDateEpoch || git.commitTime;
const startedOn = new Date(epoch * 1000).toISOString();
const finishedOn = artifactInfo?.builtAt ?? new Date().toISOString();

const invocationId = createHash('sha256').update(git.commit + ':' + artifactSha).digest('hex');
const statement = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: manifestArtifacts.map((entry) => ({ name: path.basename(entry.path), digest: { sha256: entry.sha256 } })),
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'https://github.com/iffinland/wordpress-to-qortal/buildtypes/qms-release@1',
      externalParameters: {
        product: release.product,
        version: release.version,
        components: Object.fromEntries(['desktop','publisher','cms'].map((id) => [id, componentVersion(release, id)])),
        channel: release.channel,
        architecture: release.architecture,
        signing: release.signing,
        artifacts: manifestArtifacts.map((entry) => ({
          kind: entry.kind,
          component: entry.component,
          componentVersion: entry.componentVersion,
          name: entry.name,
          sha256: entry.sha256,
          bytes: entry.bytes,
          layout: entry.layout
        }))
      },
      internalParameters: {
        sourceDateEpoch: epoch,
        electronVersion: electronPackage.version,
        nodeVersion: process.version,
        npmVersion: process.env.npm_config_user_agent ?? null,
        builderHost: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        reproducibleBuild: true
      },
      resolvedDependencies
    },
    runDetails: {
      builder: {
        id: 'urn:qms:release-builder:local',
        version: { 'qms-release-scripts': release.version },
        builderDependencies: []
      },
      metadata: {
        invocationId: 'urn:uuid:' + invocationId.slice(0, 8) + '-' + invocationId.slice(8, 12) + '-' + invocationId.slice(12, 16) + '-' + invocationId.slice(16, 20) + '-' + invocationId.slice(20, 32),
        startedOn,
        finishedOn
      },
      byproducts: [
        { name: 'desktop/release/artifact.json', digest: { sha256: createHash('sha256').update(JSON.stringify(artifactInfo ?? {})).digest('hex') } },
        { name: 'desktop/release/validation.json', digest: { sha256: createHash('sha256').update(JSON.stringify(validation ?? {})).digest('hex') } }
      ]
    }
  }
};

await writeJson(path.join(REPO_ROOT, 'desktop/release/provenance.intoto.json'), statement);
await writeJson(path.join(REPO_ROOT, 'desktop/release/build-info.json'), {
  schema: 'qms-build-info@1',
  product: release.product,
  version: release.version,
  channel: release.channel,
  signing: release.signing,
  artifact: path.basename(artifact),
  sha256: artifactSha,
  bytes: (await readJson(path.join(REPO_ROOT, 'desktop/release/artifact.json'))).bytes,
  sourceCommit: git.commit,
  sourceTree: git.tree,
  branch: git.branch,
  dirty: git.dirty,
  sourceDateEpoch: epoch,
  electronVersion: electronPackage.version,
  nodeVersion: process.version,
  platform: process.platform + '/' + process.arch,
  builderHost: os.hostname(),
  commands: [
    'npm --prefix templates/generic-cms run build',
    'npm --prefix desktop run build',
    'npm --prefix desktop run prepare:engine',
    'electron-builder --linux dir',
    'dpkg-deb --build --root-owner-group --uniform-compression -Zgzip -z9',
    'npm --prefix templates/generic-cms run build -- --zip',
    'npm run publisher:build',
    'npm run publisher:validate',
    'npm run publisher:package'
  ]
});
console.log('provenance written for ' + path.basename(artifact) + ' sha256=' + artifactSha);

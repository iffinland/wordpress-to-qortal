#!/usr/bin/env node
/**
 * CycloneDX 1.5 SBOM for the packaged artifact.
 *
 * Shipped components: the Electron runtime, engine production dependencies and
 * browser libraries bundled into the generic CMS template. Build-only
 * dependencies are included with scope "excluded" so the supply chain is
 * auditable without overstating what the artifact contains.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { REPO_ROOT, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const artifactArg = process.argv.find((value) => value.startsWith('--artifact='));
const artifact = artifactArg
  ? path.resolve(artifactArg.slice('--artifact='.length))
  : path.join(REPO_ROOT, 'desktop/release', 'qortal-migration-studio_' + componentVersion(release, 'desktop').replace(/-/g, '~') + '_amd64.deb');
const outArg = process.argv.find((value) => value.startsWith('--out='));
const output = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(REPO_ROOT, 'desktop/release/sbom.cdx.json');

const git = gitInfo(REPO_ROOT);
const artifactSha = await sha256File(artifact);
const timestamp = new Date((Number(process.env.SOURCE_DATE_EPOCH) || git.commitTime) * 1000).toISOString();

function hashFromIntegrity(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(String(integrity ?? ''));
  if (!match) return [];
  return [{ alg: 'SHA-512', content: Buffer.from(match[1], 'base64').toString('hex') }];
}

function purlFor(name, version) {
  const encoded = name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)).replace('%2F', '/') : encodeURIComponent(name);
  return 'pkg:npm/' + encoded + '@' + encodeURIComponent(version);
}

const components = new Map();

function addLock(file, { scope, buildOnly }) {
  return readJson(file).then((lock) => {
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key || !entry.version || entry.link) continue;
      const name = entry.name ?? key.replace(/^node_modules\//, '').replace(/.*node_modules\//, '');
      if (!name || name.startsWith('qortal-migration-studio')) continue;
      const bomRef = purlFor(name, entry.version);
      if (components.has(bomRef)) continue;
      components.set(bomRef, {
        type: 'library',
        'bom-ref': bomRef,
        name,
        version: entry.version,
        purl: bomRef,
        scope,
        hashes: hashFromIntegrity(entry.integrity),
        properties: [
          { name: 'qms:sourceLock', value: path.relative(REPO_ROOT, file).split(path.sep).join('/') },
          { name: 'qms:buildOnly', value: String(buildOnly) }
        ]
      });
    }
  });
}

await addLock(path.join(REPO_ROOT, 'desktop/engine-package/package-lock.json'), { scope: 'required', buildOnly: false });
await addLock(path.join(REPO_ROOT, 'templates/generic-cms/package-lock.json'), { scope: 'required', buildOnly: false });
await addLock(path.join(REPO_ROOT, 'desktop/package-lock.json'), { scope: 'excluded', buildOnly: true });

const electronPackage = await readJson(path.join(REPO_ROOT, 'desktop/node_modules/electron/package.json'));
components.set('pkg:npm/electron@' + electronPackage.version, {
  type: 'framework',
  'bom-ref': 'pkg:npm/electron@' + electronPackage.version,
  name: 'electron',
  version: electronPackage.version,
  purl: 'pkg:npm/electron@' + electronPackage.version,
  scope: 'required',
  properties: [
    { name: 'qms:runtime', value: 'desktop' },
    { name: 'qms:chromium', value: String(electronPackage.dependencies ? '' : process.env.npm_config_electron_version ?? 'bundled') }
  ]
});

const releaseManifestPath = path.join(REPO_ROOT, 'release/release-manifest.json');
let releaseManifest = null;
try {
  releaseManifest = await readJson(releaseManifestPath);
} catch {
  releaseManifest = null;
}
if (!releaseManifest || releaseManifest.schema !== 'qms-release-artifacts@1') {
  console.error('three-artifact release manifest is missing; run the release gate before generating the SBOM.');
  process.exitCode = 1;
}
const releaseArtifacts = releaseManifest?.artifacts ?? [];
for (const entry of releaseArtifacts) {
  if (entry.kind === 'deb') continue;
  const entryVersion = entry.componentVersion ?? entry.version ?? release.version;
  const bomRef = 'pkg:generic/' + entry.name.replace(/\.zip$/, '') + '@' + entryVersion;
  components.set(bomRef, {
    type: 'application',
    'bom-ref': bomRef,
    name: entry.name,
    version: entryVersion,
    purl: bomRef,
    scope: 'required',
    hashes: [{ alg: 'SHA-256', content: entry.sha256 }],
    properties: [
      { name: 'qms:artifactKind', value: entry.kind },
      { name: 'qms:component', value: entry.component ?? '' },
      { name: 'qms:artifactLayout', value: entry.layout },
      { name: 'qms:artifactBytes', value: String(entry.bytes) }
    ]
  });
}

const sorted = [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
const seed = createHash('sha256').update(git.commit + ':' + artifactSha).digest('hex');
const serial = [seed.slice(0, 8), seed.slice(8, 12), '5' + seed.slice(13, 16), ((parseInt(seed.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + seed.slice(18, 20), seed.slice(20, 32)].join('-');

const sbom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:' + serial,
  version: 1,
  metadata: {
    timestamp,
    tools: { components: [{ type: 'application', name: 'qms-release-sbom', version: release.version }] },
    authors: [{ name: 'Qortal Migration Studio release pipeline' }],
    component: {
      type: 'application',
      'bom-ref': 'pkg:generic/qortal-migration-studio@' + componentVersion(release, 'desktop'),
      name: release.debianPackage,
      version: componentVersion(release, 'desktop'),
      purl: 'pkg:generic/qortal-migration-studio@' + componentVersion(release, 'desktop'),
      hashes: [{ alg: 'SHA-256', content: artifactSha }],
      properties: [
        { name: 'qms:sourceCommit', value: git.commit },
        { name: 'qms:sourceTree', value: git.tree },
        { name: 'qms:channel', value: release.channel },
        { name: 'qms:signing', value: release.signing },
        { name: 'qms:artifact', value: path.basename(artifact) },
        { name: 'qms:bundleVersion', value: release.version },
        { name: 'qms:artifactId', value: 'sha256:' + artifactSha }
      ]
    }
  },
  components: sorted
};

await writeJson(output, sbom);
console.log('SBOM written: ' + output + ' (' + sorted.length + ' components, shipped=' + sorted.filter((entry) => entry.scope === 'required').length + ')');

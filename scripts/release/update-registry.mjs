#!/usr/bin/env node
/**
 * Generate the shared QDN update registry from a verified release manifest.
 *
 * Safety properties:
 * - Reads only a release manifest that already passed the three-artifact gate.
 * - Re-downloads every public asset and verifies exact size and SHA-256.
 * - Never advertises a component whose version did not change.
 * - Refuses to change an artifact under an unchanged component version.
 * - Refuses to downgrade a component or overwrite a malformed existing registry.
 * - Produces a deterministic Publisher-compatible handoff only when the
 *   published registry actually differs.
 * - Never publishes, signs, authenticates or stores keys. The owner imports the
 *   handoff into Qortal Hub and approves the publication.
 *
 * Usage:
 *   npm run release:registry -- --tag=v0.8.0-alpha.1 --node-url=http://127.0.0.1:12391
 *   npm run release:registry -- --verify-published --node-url=...
 *   npm run release:registry -- --registry-file=release/current-registry.json --skip-public-check
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { stableStringify } from '../../lib/model/content.js';
import { validateHandoffPackage } from '../../lib/engine/publication/handoff.js';
import {
  COMPONENT_IDS,
  REGISTRY_IDENTITY,
  REGISTRY_SCHEMA,
  compareSemver,
  parseRegistryDocument
} from '../../lib/update/registry.js';
import { REPO_ROOT, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

export const REGISTRY_PUBLICATION_SCHEMA = 'qms-update-registry-publication@1';
export const REGISTRY_DIFF_SCHEMA = 'qms-update-registry-diff@1';
const REPO = 'iffinland/wordpress-to-qortal';
const DEFAULT_NODE = 'http://100.116.185.83:12391';
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z');

const INSTALL = {
  desktop: {
    kind: 'debian-package',
    instructions: [
      'Download the .deb named in this record from the verified GitHub release.',
      'Verify its SHA-256 against the value shown here.',
      'Install with: sudo apt install ./qortal-migration-studio_<version>_amd64.deb',
      'The package is unsigned; verify the hash and read the release notes before installing.'
    ].join(' ')
  },
  publisher: {
    kind: 'qapp-zip',
    instructions: [
      'Download the Publisher Q-App ZIP from the verified GitHub release and check its SHA-256.',
      'In Qortal Hub, publish the ZIP as an APP under your own name, replacing only the Publisher app resource.',
      'Keep the previous ZIP until the new Publisher opens and existing handoffs remain valid.',
      'This update never changes your Qortal name, keys or publication approvals.'
    ].join(' ')
  },
  cms: {
    kind: 'qapp-zip',
    instructions: [
      'Download the Generic CMS Q-App ZIP from the verified GitHub release and check its SHA-256.',
      'Preserve the published qms-cms-config.json and any custom template assets; do not replace a customized deployment with the generic ZIP.',
      'Republish the APP or WEBSITE bundle in Qortal Hub under the same Qortal name.',
      'The running site is never replaced automatically.'
    ].join(' ')
  }
};

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Tag(bytes) {
  return 'sha256:' + sha256Bytes(bytes);
}

function canonicalBytes(document) {
  return Buffer.from(stableStringify(document) + '\n', 'utf8');
}

function option(argv, name) {
  const prefix = '--' + name + '=';
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function fetchWithRetry(fetchImpl, url, { attempts = 3, timeoutMs = 30_000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store' });
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Request failed: ' + url);
}

export async function verifyPublicArtifacts(artifacts, { fetchImpl = fetch } = {}) {
  const results = [];
  for (const artifact of artifacts) {
    const response = await fetchWithRetry(fetchImpl, artifact.url);
    if (!response.ok) {
      throw new Error('Public artifact is not accessible (' + response.status + '): ' + artifact.url);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const sha256 = sha256Bytes(body);
    if (body.length !== artifact.bytes || sha256 !== artifact.sha256) {
      throw new Error(
        'Public artifact verification failed for ' + artifact.name + ': expected ' + artifact.bytes + ' bytes / ' + artifact.sha256
        + ', got ' + body.length + ' bytes / ' + sha256 + '.'
      );
    }
    results.push({ name: artifact.name, url: artifact.url, bytes: body.length, sha256, ok: true });
  }
  return results;
}

export function artifactRecordsFromManifest(release, manifest) {
  const tag = manifest.tag ?? release.releaseTag;
  const records = {};
  for (const id of COMPONENT_IDS) {
    const entry = manifest.artifacts.find((artifact) => artifact.component === id);
    if (!entry) throw new Error('Release manifest is missing the ' + id + ' artifact.');
    if (entry.componentVersion !== componentVersion(release, entry.kind)) {
      throw new Error('Release manifest component version mismatch for ' + id + '.');
    }
    const url = 'https://github.com/' + REPO + '/releases/download/' + tag + '/' + entry.name;
    records[id] = {
      platform: id === 'desktop' ? 'linux-x64' : 'qortal-hub',
      format: entry.kind === 'deb' ? 'deb' : 'zip',
      name: entry.name,
      bytes: entry.bytes,
      sha256: entry.sha256,
      url
    };
  }
  return records;
}

export function buildRegistryDocument({ release, manifest, artifacts, current = null, generatedAt, releaseDate, summary }) {
  const tag = manifest.tag ?? release.releaseTag;
  const components = {};
  let changed = false;
  const diff = {};
  for (const id of COMPONENT_IDS) {
    const version = release.components[id].version;
    const previous = current?.components?.[id] ?? null;
    const nextArtifact = artifacts[id];
    if (previous) {
      const order = compareSemver(version, previous.version);
      if (order < 0) {
        throw new Error('Refusing to downgrade component ' + id + ' from ' + previous.version + ' to ' + version + '.');
      }
      if (order === 0) {
        const same = previous.artifacts.length === 1
          && previous.artifacts[0].name === nextArtifact.name
          && previous.artifacts[0].bytes === nextArtifact.bytes
          && previous.artifacts[0].sha256 === nextArtifact.sha256
          && previous.artifacts[0].url === nextArtifact.url;
        if (!same) {
          throw new Error('Component ' + id + ' changed without a version bump: ' + version + '. Bump its component version before releasing.');
        }
        components[id] = previous;
        diff[id] = { changed: false, version, previousVersion: previous.version };
        continue;
      }
    }
    changed = true;
    components[id] = {
      id,
      displayName: id === 'desktop' ? 'Qortal Migration Studio (Desktop)' : id === 'publisher' ? 'Migration Publisher' : 'Generic CMS',
      version,
      channel: release.components[id].channel,
      releaseTag: tag,
      releaseDate,
      releaseUrl: 'https://github.com/' + REPO + '/releases/tag/' + tag,
      changelog: {
        summary: release.components[id].changelog ?? summary,
        url: 'https://github.com/' + REPO + '/releases/tag/' + tag
      },
      supportedPlatforms: [nextArtifact.platform],
      minimumDependencies: {},
      install: INSTALL[id],
      artifacts: [nextArtifact]
    };
    diff[id] = {
      changed: true,
      version,
      previousVersion: previous?.version ?? null,
      previousSha256: previous?.artifacts?.[0]?.sha256 ?? null,
      sha256: nextArtifact.sha256
    };
  }
  const document = {
    schema: REGISTRY_SCHEMA,
    registry: { ...REGISTRY_IDENTITY },
    product: release.product,
    generatedAt,
    sequence: changed ? (current?.sequence ?? 0) + 1 : (current?.sequence ?? 1),
    components
  };
  return { document, changed, diff };
}

export function diffAgainstPublished(previousDocument, nextDocument, diff) {
  const entries = {};
  for (const id of COMPONENT_IDS) {
    const before = previousDocument?.components?.[id]?.version ?? null;
    const after = nextDocument.components[id].version;
    entries[id] = { before, after, ...diff[id] };
  }
  return {
    schema: REGISTRY_DIFF_SCHEMA,
    previousSequence: previousDocument?.sequence ?? null,
    nextSequence: nextDocument.sequence,
    changeRequired: Boolean(previousDocument === null || diff && Object.values(diff).some((entry) => entry.changed)),
    components: entries
  };
}

function base32FromHex(hex) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = Buffer.from(hex, 'hex');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function handoffIds(payloadHash) {
  const suffix = payloadHash.slice(0, 24);
  return {
    handoffId: 'hof_' + suffix,
    publicationBatchId: 'pub_' + suffix,
    planId: 'plan_' + suffix,
    projectId: 'prj_qms-update-registry',
    siteId: 'site_' + payloadHash.slice(0, 32),
    siteNamespace: 'ns' + base32FromHex(payloadHash).slice(0, 40),
    resourceId: 'res_' + payloadHash.slice(52, 72)
  };
}

export function buildRegistryHandoff({ documentBytes, feePerResource, createdAt }) {
  const payloadHash = sha256Bytes(documentBytes);
  const ids = handoffIds(payloadHash);
  const estimate = {
    label: 'QDN update registry publication (1 DOCUMENT resource)',
    resourceCount: 1,
    feePerResource,
    estimatedFee: feePerResource,
    currency: 'QORT',
    batches: 1
  };
  const manifest = {
    schema: 'qms-publication-handoff@1',
    version: 1,
    handoffId: ids.handoffId,
    publicationBatchId: ids.publicationBatchId,
    planId: ids.planId,
    projectId: ids.projectId,
    siteId: ids.siteId,
    siteNamespace: ids.siteNamespace,
    createdAt,
    target: { qdnName: REGISTRY_IDENTITY.name, resourcePrefix: 'qms' },
    estimate,
    resources: [{
      id: ids.resourceId,
      kind: 'manifest',
      service: REGISTRY_IDENTITY.service,
      name: REGISTRY_IDENTITY.name,
      identifier: REGISTRY_IDENTITY.identifier,
      relativePath: 'payload/document/qms-update-registry.json',
      contentType: 'application/json; charset=utf-8',
      bytes: documentBytes.length,
      sha256: sha256Tag(documentBytes),
      order: 0,
      dependsOn: []
    }],
    integrity: { algorithm: 'sha256', value: sha256Tag(Buffer.from(stableStringify({
      schema: 'qms-publication-handoff@1',
      version: 1,
      handoffId: ids.handoffId,
      publicationBatchId: ids.publicationBatchId,
      planId: ids.planId,
      projectId: ids.projectId,
      siteId: ids.siteId,
      siteNamespace: ids.siteNamespace,
      createdAt,
      target: { qdnName: REGISTRY_IDENTITY.name, resourcePrefix: 'qms' },
      estimate,
      resources: [{
        id: ids.resourceId,
        kind: 'manifest',
        service: REGISTRY_IDENTITY.service,
        name: REGISTRY_IDENTITY.name,
        identifier: REGISTRY_IDENTITY.identifier,
        relativePath: 'payload/document/qms-update-registry.json',
        contentType: 'application/json; charset=utf-8',
        bytes: documentBytes.length,
        sha256: sha256Tag(documentBytes),
        order: 0,
        dependsOn: []
      }]
    }), 'utf8')) }
  };
  return manifest;
}

function deterministicZip(files) {
  const entries = {};
  for (const [name, bytes] of Object.entries(files)) {
    entries[name] = [new Uint8Array(bytes), { level: 6, mtime: ZIP_MTIME }];
  }
  return Buffer.from(zipSync(entries, { level: 6, mtime: ZIP_MTIME }));
}

export async function readPublishedRegistry(nodeUrl, { fetchImpl = fetch } = {}) {
  const base = String(nodeUrl).replace(/\/+$/, '');
  const url = base + '/arbitrary/DOCUMENT/' + encodeURIComponent(REGISTRY_IDENTITY.name) + '/' + encodeURIComponent(REGISTRY_IDENTITY.identifier) + '?encoding=base64';
  const propertiesUrl = base + '/arbitrary/resource/properties/DOCUMENT/' + encodeURIComponent(REGISTRY_IDENTITY.name) + '/' + encodeURIComponent(REGISTRY_IDENTITY.identifier);
  const response = await fetchWithRetry(fetchImpl, url, { attempts: 2, timeoutMs: 15_000 });
  let properties = null;
  try {
    const propResponse = await fetchWithRetry(fetchImpl, propertiesUrl, { attempts: 1, timeoutMs: 10_000 });
    if (propResponse.ok) properties = await propResponse.json();
  } catch {
    properties = null;
  }
  if (response.status === 404) {
    return { exists: false, bytes: null, document: null, properties, url, status: 404 };
  }
  if (!response.ok) throw new Error('Registry read-back failed with HTTP ' + response.status + ': ' + url);
  const contentType = response.headers.get('content-type') ?? '';
  let raw;
  if (/base64/i.test(contentType) || /text\/plain/i.test(contentType)) {
    const text = (await response.text()).replace(/\s+/g, '');
    raw = Buffer.from(text, 'base64');
  } else {
    raw = Buffer.from(await response.arrayBuffer());
  }
  return { exists: true, bytes: raw, document: raw.toString('utf8'), properties, url, status: response.status };
}

async function unitFeeQort(nodeUrl, { fetchImpl = fetch } = {}) {
  const url = String(nodeUrl).replace(/\/+$/, '') + '/transactions/unitfee?txType=ARBITRARY&timestamp=' + Date.now();
  const response = await fetchWithRetry(fetchImpl, url, { attempts: 2, timeoutMs: 10_000 });
  if (!response.ok) throw new Error('Unit fee request failed with HTTP ' + response.status + '.');
  const atomic = Number(String(await response.text()).trim());
  if (!Number.isFinite(atomic) || atomic <= 0) throw new Error('The node returned an invalid ARBITRARY unit fee.');
  return { atomic, qort: atomic / 1e8 };
}

function assertNoChange(publicationPath, report) {
  return writeJson(publicationPath, report);
}

async function run() {
  const argv = process.argv.slice(2);
  const nodeUrl = option(argv, 'node-url') ?? process.env.QMS_UPDATE_NODE_URL ?? DEFAULT_NODE;
  const tagArg = option(argv, 'tag');
  const manifestPath = option(argv, 'manifest') ?? path.join(REPO_ROOT, 'release/release-manifest.json');
  const registryFile = option(argv, 'registry-file');
  const skipPublicCheck = argv.includes('--skip-public-check');
  const verifyPublished = argv.includes('--verify-published');
  const outputDir = path.join(REPO_ROOT, 'release');

  const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
  if (release.schema !== 'qms-release@2') {
    throw new Error('release:registry requires qms-release@2 with independent component versions.');
  }
  const manifest = await readJson(manifestPath);
  if (manifest.schema !== 'qms-release-artifacts@1' || manifest.ok !== true) {
    throw new Error('The release manifest is missing or the three-artifact gate did not pass.');
  }
  const tag = tagArg ?? manifest.tag ?? release.releaseTag;
  if (manifest.tag !== tag) throw new Error('Release manifest tag does not match --tag=' + tag + '.');

  let published = null;
  if (registryFile) {
    const raw = await readFile(path.resolve(registryFile));
    published = { exists: true, bytes: raw, document: raw.toString('utf8'), properties: null, url: 'file:' + registryFile, status: 200 };
  } else {
    published = await readPublishedRegistry(nodeUrl);
  }

  let currentDocument = null;
  if (published.exists) {
    const parsed = parseRegistryDocument(published.document);
    if (!parsed.ok) {
      if (verifyPublished) throw new Error('Published registry is invalid: ' + parsed.errors.join('; '));
      if (!argv.includes('--replace-invalid')) {
        throw new Error('The published registry is malformed and will not be overwritten without --replace-invalid: ' + parsed.errors.join('; '));
      }
    } else {
      currentDocument = parsed.registry;
    }
  }

  if (verifyPublished) {
    if (!currentDocument) throw new Error('No valid registry is published at ' + published.url);
    const localPath = option(argv, 'file') ?? path.join(outputDir, 'qms-update-registry.json');
    const localBytes = await readFile(path.resolve(localPath));
    const localSha = sha256Bytes(localBytes);
    const remoteSha = sha256Bytes(published.bytes);
    const report = {
      schema: 'qms-update-registry-verification@1',
      ok: localSha === remoteSha,
      nodeUrl,
      url: published.url,
      localPath: path.resolve(localPath),
      localSha256: localSha,
      remoteSha256: remoteSha,
      localBytes: localBytes.length,
      remoteBytes: published.bytes.length,
      sequence: currentDocument.sequence,
      components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, currentDocument.components[id]?.version ?? null])),
      verifiedAt: new Date().toISOString()
    };
    await writeJson(path.join(outputDir, 'registry-verification.json'), report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  const artifacts = artifactRecordsFromManifest(release, manifest);
  const publicVerification = skipPublicCheck ? { skipped: true, artifacts: [] } : { skipped: false, artifacts: await verifyPublicArtifacts(Object.values(artifacts)) };

  const git = gitInfo(REPO_ROOT);
  const generatedAt = new Date(git.commitTime * 1000).toISOString();
  const summary = release.changelog?.summary ?? 'Qortal Migration Studio release ' + release.version + '.';
  const built = buildRegistryDocument({
    release,
    manifest,
    artifacts,
    current: currentDocument,
    generatedAt,
    releaseDate: generatedAt,
    summary
  });
  const documentBytes = canonicalBytes(built.document);
  const parsedNext = parseRegistryDocument(built.document);
  if (!parsedNext.ok) throw new Error('Generated registry failed validation: ' + parsedNext.errors.join('; '));

  const publishedSha = published.exists ? sha256Bytes(published.bytes) : null;
  const nextSha = sha256Bytes(documentBytes);
  const alreadyPublished = publishedSha === nextSha;
  const changeRequired = alreadyPublished ? false : (currentDocument === null || built.changed);
  const diff = diffAgainstPublished(currentDocument, built.document, built.diff);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'qms-update-registry.json'), documentBytes);
  await writeJson(path.join(outputDir, 'registry-diff.json'), diff);

  const collision = {
    resource: 'DOCUMENT/' + REGISTRY_IDENTITY.name + '/' + REGISTRY_IDENTITY.identifier,
    exists: published.exists,
    status: published.status,
    existingSha256: publishedSha,
    nextSha256: nextSha,
    sameContent: alreadyPublished,
    properties: published.properties
  };

  if (!changeRequired) {
    const report = {
      schema: REGISTRY_PUBLICATION_SCHEMA,
      ok: true,
      changeRequired: false,
      alreadyPublished,
      reason: alreadyPublished ? 'The published registry already matches the generated document.' : 'No component changed; the published registry stays authoritative.',
      tag,
      nodeUrl,
      registry: { ...REGISTRY_IDENTITY, schema: REGISTRY_SCHEMA },
      payload: { bytes: documentBytes.length, sha256: nextSha },
      sequence: built.document.sequence,
      components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, built.document.components[id].version])),
      collision,
      diff,
      publicArtifacts: publicVerification,
      publicationPerformed: false,
      signingPerformed: false,
      generatedAt: new Date().toISOString()
    };
    await assertNoChange(path.join(outputDir, 'registry-publication.json'), report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const fee = await unitFeeQort(nodeUrl);
  const handoff = buildRegistryHandoff({ documentBytes, feePerResource: fee.qort, createdAt: generatedAt });
  const handoffDir = path.join(outputDir, 'registry-handoff');
  const payloadPath = path.join(handoffDir, 'payload/document/qms-update-registry.json');
  await mkdir(path.dirname(payloadPath), { recursive: true });
  await writeFile(payloadPath, documentBytes);
  await writeJson(path.join(handoffDir, 'handoff.json'), handoff);
  await validateHandoffPackage({ handoffDir });

  const zipBytes = deterministicZip({
    'handoff.json': await readFile(path.join(handoffDir, 'handoff.json')),
    'payload/document/qms-update-registry.json': documentBytes
  });
  const zipPath = path.join(outputDir, 'qms-update-registry-handoff.zip');
  await writeFile(zipPath, zipBytes);

  const report = {
    schema: REGISTRY_PUBLICATION_SCHEMA,
    ok: true,
    changeRequired: true,
    alreadyPublished: false,
    tag,
    nodeUrl,
    registry: { ...REGISTRY_IDENTITY, schema: REGISTRY_SCHEMA },
    payload: {
      bytes: documentBytes.length,
      sha256: nextSha,
      path: path.relative(REPO_ROOT, payloadPath).split(path.sep).join('/')
    },
    handoff: {
      path: path.relative(REPO_ROOT, zipPath).split(path.sep).join('/'),
      bytes: zipBytes.length,
      sha256: sha256Bytes(zipBytes),
      handoffId: handoff.handoffId,
      publicationBatchId: handoff.publicationBatchId
    },
    sequence: built.document.sequence,
    components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, built.document.components[id].version])),
    diff,
    fee: {
      currency: 'QORT',
      unitFeeAtomic: fee.atomic,
      unitFee: fee.qort,
      resourceCount: 1,
      estimatedFee: fee.qort,
      source: String(nodeUrl).replace(/\/+$/, '') + '/transactions/unitfee?txType=ARBITRARY',
      note: 'One DOCUMENT resource. Hub shows the final fee at approval time; this quote is read-only and is not a payment.'
    },
    collision,
    publicArtifacts: publicVerification,
    publicationPerformed: false,
    signingPerformed: false,
    ownerAction: {
      steps: [
        'Download ' + path.relative(REPO_ROOT, zipPath).split(path.sep).join('/') + ' and verify its SHA-256.',
        'Open Qortal Hub and choose the Migration Publisher Q-App.',
        'Select the handoff ZIP, confirm the target name "' + REGISTRY_IDENTITY.name + '", and review the single DOCUMENT/' + REGISTRY_IDENTITY.identifier + ' resource.',
        'Approve the publication in Hub. The Publisher verifies the exact read-back afterwards.',
        'Run: npm run release:registry -- --verify-published --node-url=<node>'
      ],
      expectedPayloadSha256: nextSha,
      expectedFee: fee.qort + ' QORT',
      expectedResource: 'DOCUMENT/' + REGISTRY_IDENTITY.name + '/' + REGISTRY_IDENTITY.identifier
    },
    generatedAt: new Date().toISOString()
  };
  await writeJson(path.join(outputDir, 'registry-publication.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    await run();
  } catch (error) {
    console.error('update registry generation FAILED: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

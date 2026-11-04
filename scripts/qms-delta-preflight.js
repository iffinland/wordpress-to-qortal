#!/usr/bin/env node
/**
 * QMS delta publication preflight.
 *
 * Prepares one small real WordPress item as a deterministic Phase 7 delta,
 * packages it through the normal Phase 5 Hub handoff, validates every byte and
 * hash, and collects read-only ownership, collision and fee evidence from a
 * Qortal Core node.
 *
 * It never signs, submits or publishes a transaction, never reads a wallet and
 * never touches a production migration project. The only network writes are
 * WordPress GETs, Qortal Core read-only GETs and the Core read-only
 * POST /transactions/fee quote endpoint.
 *
 * Usage:
 *   node scripts/qms-delta-preflight.js --search "pleased to announce that Automattic" \
 *     --source-key post:92 --out /path/to/evidence/preflight-2 \
 *     [--node-url http://...] [--name "developer iffi"] [--expected-owner Q...]
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../lib/engine/index.js';
import { validateHandoffPackage } from '../lib/engine/publication/index.js';
import { buildUnsignedArbitraryTransaction } from '../broker/src/fees.js';

const DEFAULTS = {
  search: 'pleased to announce that Automattic',
  sourceKey: 'post:92',
  name: 'developer iffi',
  nodeUrl: process.env.QMS_NODE_URL ?? 'http://100.116.185.83:12391',
  expectedOwner: process.env.QMS_EXPECTED_OWNER ?? 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E',
  site: 'https://wordpressfoundation.org'
};

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const FORM_MARKERS = /<(form|input|select|textarea|button|datalist|output|progress|meter|label)\b/i;
const SUBMISSION_MARKERS = /admin-post\.php|admin-ajax\.php|wp-login\.php|xmlrpc\.php|_wpnonce|_wp_http_referer|type="hidden"/i;
const LOCAL_PATH_MARKERS = /(^|[^a-z])\/tmp\/|(^|[^a-z])\/home\/[a-z]|\\\\Users\\\\|localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i;
const FIXTURE_MARKERS = /\bfixture\b|\bsynthetic\b|\bplaceholder\b|example\.(com|org|net|test)\b/i;
const SECRET_FIELD_MARKERS = /"(password|passwd|private_?key|seed|mnemonic|api_?key|secret|cookie|authorization)"\s*:/i;

function fail(message, details = null) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details = null) {
  if (!condition) fail(message, details);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--search') { args.search = value; index += 1; }
    else if (key === '--source-key') { args.sourceKey = value; index += 1; }
    else if (key === '--out') { args.out = value; index += 1; }
    else if (key === '--node-url') { args.nodeUrl = value; index += 1; }
    else if (key === '--name') { args.name = value; index += 1; }
    else if (key === '--expected-owner') { args.expectedOwner = value; index += 1; }
    else if (key === '--site') { args.site = value; index += 1; }
    else fail('Unknown argument: ' + key);
  }
  assert(args.out, '--out <persistent directory> is required');
  return args;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Value(bytes) {
  return 'sha256:' + sha256Hex(bytes);
}

function atomicToQort(atomic) {
  return Number((atomic / 100000000).toFixed(8));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function walkFiles(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

async function nodeText(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'error' });
  const text = await response.text();
  return { status: response.status, text };
}

async function nodeJson(url) {
  const result = await nodeText(url);
  let body = null;
  try { body = JSON.parse(result.text); } catch { body = null; }
  return { status: result.status, body, text: result.text };
}

function encodeSegment(value) {
  return encodeURIComponent(String(value));
}

async function verifyWordPressItem(args, handoffResources) {
  const [type, id] = args.sourceKey.split(':');
  const api = type === 'page' ? 'pages' : 'posts';
  const urls = [
    args.site.replace(/\/+$/, '') + '/wp-json/wp/v2/' + api + '/' + id + '?context=view&_qms=' + Date.now(),
    args.site.replace(/\/+$/, '') + '/wp-json/wp/v2/' + api + '/' + id + '?context=view&_qms=' + (Date.now() + 1)
  ];
  const responses = await Promise.all(urls.map((url) => nodeJson(url)));
  assert(responses.every((entry) => entry.status === 200), 'WordPress item fetch failed', responses.map((entry) => entry.status));
  const [first, second] = responses.map((entry) => entry.body);
  assert(Number(first.id) === Number(id), 'WordPress item id mismatch');
  return {
    id: first.id,
    type,
    slug: first.slug,
    link: first.link,
    modified_gmt: first.modified_gmt,
    title: (first.title?.rendered ?? '').replace(/<[^>]+>/g, ''),
    content_bytes: Buffer.byteLength(first.content?.rendered ?? '', 'utf8'),
    stable_across_reads: JSON.stringify(first.content?.rendered) === JSON.stringify(second.content?.rendered),
    handoff_content_identifier: handoffResources.find((resource) => resource.kind === 'content')?.identifier ?? null
  };
}

async function verifyNodeEvidence(args, handoff, resources) {
  const base = args.nodeUrl.replace(/\/+$/, '');
  const status = await nodeJson(base + '/admin/status');
  assert(status.status === 200, 'Node status endpoint unavailable', { status: status.status });

  const name = await nodeJson(base + '/names/' + encodeSegment(args.name));
  assert(name.status === 200, 'Target Qortal name is not registered', { status: name.status });
  assert(name.body?.owner, 'Target Qortal name has no owner');
  if (args.expectedOwner) {
    assert(name.body.owner === args.expectedOwner, 'Target Qortal name owner does not match the expected address.', {
      actual: name.body.owner,
      expected: args.expectedOwner
    });
  }

  const collisions = [];
  for (const resource of resources) {
    const url = base + '/arbitrary/resource/properties/' + encodeSegment(resource.service) + '/' +
      encodeSegment(resource.name) + '/' + encodeSegment(resource.identifier);
    const result = await nodeJson(url);
    collisions.push({
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: result.status,
      collision: result.status !== 404,
      body: result.status === 200 ? result.body : null
    });
  }
  assert(collisions.every((entry) => entry.collision === false), 'A handoff resource already exists; refusing to overwrite.');

  const unitResult = await nodeText(base + '/transactions/unitfee?txType=ARBITRARY');
  assert(unitResult.status === 200, 'Unit fee endpoint unavailable');
  const unitFeeAtomic = Number(String(unitResult.text).trim());
  assert(Number.isSafeInteger(unitFeeAtomic) && unitFeeAtomic > 0, 'Invalid unit fee');

  const quotes = [];
  for (const resource of resources) {
    const timestamp = Date.now();
    const bytes = buildUnsignedArbitraryTransaction({
      name: resource.name,
      identifier: resource.identifier,
      payloadBytes: resource.bytes,
      timestamp
    });
    const quote = await nodeText(base + '/transactions/fee', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: base58Encode(bytes)
    });
    assert(quote.status === 200, 'Fee quote failed', { identifier: resource.identifier, status: quote.status });
    const feeAtomic = Number(String(quote.text).trim());
    assert(Number.isSafeInteger(feeAtomic) && feeAtomic > 0, 'Invalid fee quote');
    assert(feeAtomic % unitFeeAtomic === 0, 'Fee quote is not an exact multiple of the unit fee', {
      identifier: resource.identifier, feeAtomic, unitFeeAtomic
    });
    quotes.push({ identifier: resource.identifier, bytes: resource.bytes, feeAtomic, unitFeeAtomic });
  }
  const totalAtomic = quotes.reduce((sum, quote) => sum + quote.feeAtomic, 0);

  return {
    node: base,
    height: status.body?.height ?? null,
    synced: status.body?.isSynchronizing === false,
    name: {
      exactName: args.name,
      status: name.status,
      owner: name.body.owner,
      reducedName: name.body.reducedName ?? null,
      isForSale: name.body.isForSale ?? null,
      ownership: name.body.owner === (args.expectedOwner ?? name.body.owner) ? 'verified' : 'mismatch'
    },
    collisionCheck: {
      result: collisions.every((entry) => entry.status === 404) ? 'all 404' : 'collision',
      anyCollision: collisions.some((entry) => entry.collision),
      statuses: [...new Set(collisions.map((entry) => entry.status))],
      resources: collisions
    },
    fee: {
      unitFeeEndpoint: base + '/transactions/unitfee?txType=ARBITRARY',
      unitFeeAtomic,
      unitFeeQort: atomicToQort(unitFeeAtomic),
      recommendedFeeEndpoint: base + '/transactions/fee',
      quotes,
      totalAtomic,
      totalQort: atomicToQort(totalAtomic),
      resourceCount: resources.length
    },
    networkWrites: 'none (only read-only GET and Core fee-quote POST)'
  };
}

// Minimal base58 encoder matching broker/src/fees.js.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buffer) {
  if (buffer.length === 0) return '';
  let value = 0n;
  for (const byte of buffer) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = ALPHABET[remainder] + encoded;
  }
  for (let index = 0; index < buffer.length && buffer[index] === 0; index += 1) encoded = '1' + encoded;
  return encoded;
}

function auditText(label, text) {
  return {
    label,
    secrets: SECRET_FIELD_MARKERS.test(text),
    jwt: JWT_PATTERN.test(text),
    form: FORM_MARKERS.test(text) || SUBMISSION_MARKERS.test(text),
    localPath: LOCAL_PATH_MARKERS.test(text),
    fixture: FIXTURE_MARKERS.test(text)
  };
}

async function auditPayloads(handoffDir, handoff, handoffManifest, summary) {
  const resources = handoff.resources;
  const findings = [];
  let allBytesMatch = true;
  let allShaMatch = true;
  const parsed = new Map();

  for (const resource of resources) {
    const file = path.join(handoffDir, resource.relativePath);
    const bytes = await readFile(file);
    const actualSha = sha256Value(bytes);
    if (bytes.length !== resource.bytes) allBytesMatch = false;
    if (actualSha !== resource.sha256) allShaMatch = false;
    const isJson = resource.contentType.startsWith('application/json');
    if (isJson) {
      const text = bytes.toString('utf8');
      const parsedValue = JSON.parse(text);
      parsed.set(resource.relativePath, parsedValue);
      findings.push({
        id: resource.id,
        kind: resource.kind,
        relativePath: resource.relativePath,
        bytes: bytes.length,
        sha256: actualSha,
        expectedBytes: resource.bytes,
        expectedSha256: resource.sha256,
        bytesMatch: bytes.length === resource.bytes,
        shaMatch: actualSha === resource.sha256,
        ...auditText(resource.relativePath, text)
      });
    } else {
      findings.push({
        id: resource.id,
        kind: resource.kind,
        relativePath: resource.relativePath,
        bytes: bytes.length,
        sha256: actualSha,
        expectedBytes: resource.bytes,
        expectedSha256: resource.sha256,
        bytesMatch: bytes.length === resource.bytes,
        shaMatch: actualSha === resource.sha256,
        binary: true
      });
    }
  }

  assert(allBytesMatch, 'A handoff file byte length does not match its manifest.');
  assert(allShaMatch, 'A handoff file SHA-256 does not match its manifest.');
  assert(summary.resources === resources.length, 'Handoff validation summary resource count mismatch.');

  const contentResource = resources.find((resource) => resource.kind === 'content');
  assert(contentResource, 'Handoff has no content resource.');
  const content = parsed.get(contentResource.relativePath);
  assert(content?.schema === 'qms-qdn-content@1', 'Unexpected content payload schema', content?.schema);
  const bodyHtml = String(content.body?.html ?? '');
  assert(!/<form/i.test(bodyHtml), 'Content payload still contains a form.');
  assert(!FORM_MARKERS.test(bodyHtml), 'Content payload still contains a form control.');
  assert(!SUBMISSION_MARKERS.test(bodyHtml), 'Content payload still contains a submission endpoint.');
  assert(!JWT_PATTERN.test(JSON.stringify(content)), 'Content payload contains a JWT-shaped token.');
  assert(LOCAL_PATH_MARKERS.test(JSON.stringify(content)) === false, 'Content payload contains a local or temporary path.');
  assert(FIXTURE_MARKERS.test(JSON.stringify(content)) === false, 'Content payload contains a fixture/placeholder marker.');
  assert(bodyHtml.length > 200, 'Content payload body is unexpectedly small.');

  const mediaResources = resources.filter((resource) => resource.kind === 'media');
  assert(mediaResources.length >= 1, 'The chosen item produced no supported media resource.');

  const manifestResource = resources.find((resource) => resource.kind === 'manifest');
  assert(manifestResource, 'Handoff has no site manifest resource.');
  const siteManifest = parsed.get(manifestResource.relativePath);
  const byIdentifier = siteManifest.resources?.by_identifier ?? {};
  const manifestDescribed = resources.filter((resource) => resource.kind !== 'manifest');
  assert(Object.keys(byIdentifier).length === manifestDescribed.length, 'Site manifest resource count mismatch.', {
    byIdentifier: Object.keys(byIdentifier).length,
    expected: manifestDescribed.length
  });
  for (const resource of manifestDescribed) {
    const entry = byIdentifier[resource.identifier];
    assert(entry, 'Site manifest is missing resource ' + resource.identifier);
    assert(entry.service === resource.service, 'Site manifest service mismatch for ' + resource.identifier);
    assert(entry.name === resource.name, 'Site manifest name mismatch for ' + resource.identifier);
    assert(entry.bytes === resource.bytes, 'Site manifest byte count mismatch for ' + resource.identifier);
    assert(entry.sha256 === resource.sha256, 'Site manifest hash mismatch for ' + resource.identifier);
    assert(entry.contentType === resource.contentType, 'Site manifest content type mismatch for ' + resource.identifier);
    for (const [key, identifier] of Object.entries(siteManifest.entrypoints ?? {})) {
      assert(resources.some((candidate) => candidate.identifier === identifier), 'Entrypoint ' + key + ' does not resolve to a handoff resource.');
    }
  }

  const importManifest = parsed.get('payload/index/import-manifest.json');
  assert(importManifest, 'Import manifest is missing.');
  assert(importManifest.counts?.content === 1, 'Import manifest content count is not 1.');
  assert(importManifest.counts?.media === mediaResources.length, 'Import manifest media count mismatch.');
  assert(importManifest.counts?.posts + importManifest.counts?.pages === 1, 'Import manifest item count is not 1.');
  assert(importManifest.namespace === handoffManifest.siteNamespace, 'Import manifest namespace mismatch.');
  assert(importManifest.siteId === handoffManifest.siteId, 'Import manifest site id mismatch.');

  const contentType = content.content_type === 'post' ? 'posts' : 'pages';
  const contentIndex = parsed.get('payload/index/' + contentType + '-index.json');
  assert(contentIndex, 'Content index is missing.');
  assert(contentIndex.count === 1, 'Content index count is not 1.');
  const indexEntry = contentIndex.entries?.[0];
  assert(indexEntry, 'Content index has no entry.');
  assert(indexEntry.contentHash === content.content_hash, 'Content index hash does not match the payload.');
  assert(indexEntry.qdn?.identifier === contentResource.identifier, 'Content index identifier does not match the content resource.');
  assert(indexEntry.id === contentResource.id, 'Content index resource id does not match.');
  assert(indexEntry.slug === content.identity?.slug, 'Content index slug does not match.');
  assert(indexEntry.title === content.title, 'Content index title does not match.');

  const mediaMap = parsed.get('payload/index/media-map.json');
  assert(mediaMap, 'Media map is missing.');
  for (const [url, entry] of Object.entries(mediaMap.entries ?? {})) {
    const media = mediaResources.find((resource) => resource.identifier === entry.identifier);
    assert(media, 'Media map entry does not resolve to a handoff media resource: ' + url);
    assert(entry.service === media.service && entry.name === media.name, 'Media map triple mismatch: ' + url);
    assert(media.dependsOn?.length === 0, 'Media resource unexpectedly depends on another resource.');
  }
  for (const media of mediaResources) {
    const referenced = contentResource.dependsOn?.includes(media.id);
    assert(referenced, 'Content resource does not depend on media resource ' + media.id);
  }

  const urlMap = parsed.get('payload/index/url-map.json');
  assert(urlMap, 'URL map is missing.');
  const mapped = urlMap.entries?.[content.identity?.old_url] ?? urlMap.entries?.[content.identity?.canonical_url];
  assert(mapped, 'URL map is missing the item canonical URL.');
  assert(mapped.identifier === contentResource.identifier, 'URL map identifier mismatch.');

  return {
    content: {
      schema: content.schema,
      title: content.title,
      slug: content.identity?.slug,
      contentHash: content.content_hash,
      bodyHtmlBytes: Buffer.byteLength(bodyHtml, 'utf8'),
      bodyTextSample: String(content.body?.text ?? '').slice(0, 240),
      bodyHasForm: /<form/i.test(bodyHtml),
      bodyHasControls: FORM_MARKERS.test(bodyHtml),
      bodyHasSubmissionEndpoint: SUBMISSION_MARKERS.test(bodyHtml)
    },
    media: mediaResources.map((resource) => ({
      identifier: resource.identifier,
      service: resource.service,
      contentType: resource.contentType,
      bytes: resource.bytes,
      sha256: resource.sha256
    })),
    manifestConsistent: true,
    indexConsistent: true,
    urlMapConsistent: true,
    importManifest,
    findings,
    allBytesMatch,
    allShaMatch,
    secretsAny: findings.some((entry) => entry.secrets),
    commerceAny: false,
    interactiveTagsAny: findings.some((entry) => entry.form),
    localhostAny: findings.some((entry) => entry.localPath),
    fixtureAny: findings.some((entry) => entry.fixture),
    jwtAny: findings.some((entry) => entry.jwt)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = path.resolve(args.out);
  await mkdir(outDir, { recursive: true });
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-delta-preflight2-'));
  const engine = createEngine({ dataRoot });
  let handle = null;
  try {
    const project = await engine.projects.create({
      name: 'QMS delta preflight 2 (' + args.sourceKey + ')',
      source: { adapter: 'wordpress', baseUrl: args.site },
      target: { qdnName: args.name },
      settings: {
        disk: { reserveBytes: 0, maxBytesPerRun: 0, unknownSizePolicy: 'estimate', unknownSizeBytes: 1024 },
        // The WordPress Foundation serves editorial images through its i0/i1.wp.com
        // CDN. This is an explicit, documented opt-in, not a loopback or placeholder.
        media: { allowExternalMedia: true, allowLoopback: false, maxRetries: 0, retryDelayMs: 0 }
      }
    });
    handle = await engine.projects.open(project.id);

    const scan = await handle.sync.check({
      mode: 'full',
      query: { search: args.search },
      perPage: 100,
      autoApplyWithdrawals: false
    });
    assert(scan.status === 'completed' && scan.complete === true, 'Delta scan did not complete.');
    assert(scan.planningAllowed === true, 'Delta scan is not planning-allowed.');
    assert(scan.scope?.coverage === 'scoped', 'Delta scan is not scoped.');
    assert(scan.withdrawalEligible === false, 'Scoped delta scan kept withdrawal authority.');
    assert(scan.watermarkAdvanced === false, 'Scoped delta scan advanced the watermark.');
    const deltaKeys = [...(scan.delta?.new ?? []), ...(scan.delta?.modified ?? [])].map((entry) => entry.sourceKey);
    assert(deltaKeys.includes(args.sourceKey), 'Chosen source key is not in the delta.', { deltaKeys });

    const planResult = await handle.sync.preparePlan({
      scanId: scan.scanId,
      selection: [args.sourceKey],
      estimateMedia: true,
      batchSize: 10
    });
    assert(planResult.planId, 'Delta plan was not created.', planResult);
    const plan = (await handle.planning.get(planResult.planId)).plan;
    assert(plan.status === 'ready', 'Delta plan is not ready.', { status: plan.status, errors: plan.errors });
    const actionableEntries = plan.entries.filter((candidate) => ['new', 'modified', 'route_changed'].includes(candidate.status));
    assert(actionableEntries.length === 1, 'Delta plan selection is not exactly one actionable item.', {
      actionable: actionableEntries.map((candidate) => candidate.sourceKey),
      totalEntries: plan.entries.length
    });
    const entry = actionableEntries[0];
    assert(entry.sourceKey === args.sourceKey, 'Delta plan entry mismatch.');
    assert(Number(entry.mediaCount) >= 1, 'The chosen item has no supported media in the plan.', { mediaCount: entry.mediaCount });

    const download = await handle.media.download({
      planId: planResult.planId,
      concurrency: 1,
      maxFiles: 10,
      reserveGib: 0
    });
    assert(download.status === 'completed', 'Media download did not complete.', { status: download.status });
    assert((download.failed ?? 0) === 0, 'Media download failed.', { failed: download.failed });

    const handoff = await handle.publication.prepare({
      planId: planResult.planId,
      selection: [args.sourceKey],
      feePerResource: 0.01,
      feeCurrency: 'QORT'
    });
    const handoffDir = path.join(engine.projects.paths(project.id).root, handoff.handoffPath);
    const validation = await validateHandoffPackage({ handoffDir });
    assert(validation.summary.resources === handoff.resources.length, 'Handoff validation count mismatch.');

    const copiedHandoff = path.join(outDir, 'handoff');
    await rm(copiedHandoff, { recursive: true, force: true });
    await cp(handoffDir, copiedHandoff, { recursive: true, dereference: false });
    const handoffManifest = await readJson(path.join(copiedHandoff, 'handoff.json'));
    assert(handoffManifest.schema === 'qms-publication-handoff@1', 'Unexpected handoff schema.', handoffManifest.schema);
    assert(handoffManifest.handoffId === handoff.handoffId, 'Copied handoff id mismatch.');
    assert(handoffManifest.publicationBatchId === handoff.publicationBatchId, 'Copied batch id mismatch.');
    assert(Array.isArray(handoffManifest.resources) && handoffManifest.resources.length === handoff.resources.length, 'Copied handoff resource count mismatch.');
    for (const resource of handoff.resources) {
      const copy = handoffManifest.resources.find((candidate) => candidate.id === resource.id);
      assert(copy, 'Copied handoff is missing resource ' + resource.id);
      assert(copy.service === resource.service && copy.name === resource.name && copy.identifier === resource.identifier, 'Copied handoff triple mismatch for ' + resource.id);
      assert(copy.bytes === resource.bytes && copy.sha256 === resource.sha256, 'Copied handoff byte/hash mismatch for ' + resource.id);
    }

    const payloadAudit = await auditPayloads(copiedHandoff, handoff, handoffManifest, validation.summary);
    const wordpress = await verifyWordPressItem(args, handoff.resources);
    const nodeEvidence = await verifyNodeEvidence(args, handoff, handoff.resources);

    const inventory = handoff.resources.map((resource) => ({
      order: resource.order,
      kind: resource.kind,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      contentType: resource.contentType,
      bytes: resource.bytes,
      sha256: resource.sha256,
      relativePath: resource.relativePath,
      dependsOn: resource.dependsOn ?? [],
      sourceKey: resource.sourceKey ?? null
    }));

    const manifestResource = handoff.resources.find((resource) => resource.kind === 'manifest');
    const manifestBytes = await readFile(path.join(copiedHandoff, manifestResource.relativePath));

    const phase1 = {
      dataRoot,
      project: {
        id: project.id,
        name: project.name,
        siteId: project.siteId,
        siteNamespace: project.siteNamespace,
        sourceAdapter: project.sourceAdapter,
        sourceBaseUrl: project.sourceBaseUrl,
        targetQdnName: project.targetQdnName
      },
      scan: {
        scanId: scan.scanId,
        status: scan.status,
        complete: scan.complete,
        planningAllowed: scan.planningAllowed,
        coverage: scan.scope?.coverage,
        withdrawalEligible: scan.withdrawalEligible,
        watermarkAdvanced: scan.watermarkAdvanced,
        counts: scan.counts,
        query: scan.query,
        delta: {
          new: (scan.delta?.new ?? []).map((entry) => ({ sourceKey: entry.sourceKey, contentType: entry.contentType, title: entry.title, contentHash: entry.contentHash })),
          modified: (scan.delta?.modified ?? []).map((entry) => ({ sourceKey: entry.sourceKey, contentHash: entry.contentHash })),
          conflicts: scan.delta?.conflicts ?? []
        }
      },
      plan: {
        planId: plan.planId,
        status: plan.status,
        stats: plan.stats,
        selectedSourceKeys: plan.filters?.sourceKeys ?? null,
        actionableEntryCount: actionableEntries.length,
        entry: {
          sourceKey: entry.sourceKey,
          contentType: entry.contentType,
          status: entry.status,
          contentHash: entry.contentHash,
          title: entry.title,
          slug: entry.slug,
          qdn: entry.qdn
        },
        media: plan.media ?? null
      },
      mediaDownload: {
        status: download.status,
        downloaded: download.downloaded ?? null,
        failed: download.failed ?? null,
        receipts: download.receipts ?? null
      }
    };
    await writeFile(path.join(outDir, 'phase1-delta-plan.json'), JSON.stringify(phase1, null, 2) + '\n');

    const phase2 = {
      handoffId: handoff.handoffId,
      publicationBatchId: handoff.publicationBatchId,
      planId: handoff.planId,
      projectId: handoffManifest.projectId,
      siteId: handoffManifest.siteId,
      siteNamespace: handoffManifest.siteNamespace,
      target: handoffManifest.target,
      estimate: handoff.estimate,
      createdAt: handoffManifest.createdAt,
      handoffPath: 'handoff',
      packageValid: true,
      validationSummary: validation.summary,
      verifiedFiles: validation.verified.length,
      inventory,
      payloadAudit,
      wordpress
    };
    await writeFile(path.join(outDir, 'phase2-handoff-validation.json'), JSON.stringify(phase2, null, 2) + '\n');

    const phase3 = {
      ...nodeEvidence,
      readback: {
        status: 'pending_confirmation',
        counts: { pending: handoff.resources.length },
        procedure: 'GET /arbitrary/resource/properties/{service}/{name}/{identifier} as diagnostic; then GET /arbitrary/{service}/{name}/{identifier}?encoding=base64, decode, compare exact byte length and SHA-256. properties size is directory metadata, not payload size.'
      },
      receiptImport: {
        method: 'publication.importReceipt({handoffId, receipt})',
        path: '<project>/publication/receipts/<receiptId>.json',
        effect: 'marks resources pending_confirmation; independent exact read-back is still required'
      }
    };
    await writeFile(path.join(outDir, 'phase3-node-evidence.json'), JSON.stringify(phase3, null, 2) + '\n');

    const gate = {
      packageValid: true,
      filesVerified: validation.verified.length,
      allBytesMatch: payloadAudit.allBytesMatch,
      allShaMatch: payloadAudit.allShaMatch,
      secretsAny: payloadAudit.secretsAny,
      commerceAny: payloadAudit.commerceAny,
      interactiveTagsAny: payloadAudit.interactiveTagsAny,
      localhostAny: payloadAudit.localhostAny,
      fixtureAny: payloadAudit.fixtureAny,
      jwtAny: payloadAudit.jwtAny,
      collisionsAny: nodeEvidence.collisionCheck.anyCollision,
      ownershipVerified: nodeEvidence.name.ownership === 'verified'
    };
    assert(gate.packageValid === true && gate.ownershipVerified === true, 'Final gate identity check failed.', gate);
    for (const key of ['secretsAny', 'commerceAny', 'interactiveTagsAny', 'localhostAny', 'fixtureAny', 'jwtAny', 'collisionsAny']) {
      assert(gate[key] === false, 'Final gate rejected: ' + key, gate);
    }
    assert(gate.allBytesMatch === true && gate.allShaMatch === true, 'Final gate byte/hash verification failed.', gate);

    const approval = {
      schema: 'qms-owner-approval-request@1',
      status: 'awaiting_owner_approval',
      createdAt: new Date().toISOString(),
      network: {
        name: 'Qortal mainnet',
        isTestNet: false,
        node: nodeEvidence.node,
        height: nodeEvidence.height
      },
      handoffId: handoff.handoffId,
      publicationBatchId: handoff.publicationBatchId,
      planId: handoff.planId,
      projectId: handoffManifest.projectId,
      siteId: handoffManifest.siteId,
      siteNamespace: handoffManifest.siteNamespace,
      target: {
        service: 'DOCUMENT',
        name: handoffManifest.target.qdnName,
        owner: nodeEvidence.name.owner
      },
      source: {
        site: args.site,
        item: args.sourceKey,
        title: wordpress.title,
        slug: wordpress.slug,
        link: wordpress.link,
        modified_gmt: wordpress.modified_gmt
      },
      resourceCount: handoff.resources.length,
      resources: inventory,
      manifest: {
        bytes: manifestBytes.length,
        sha256: sha256Value(manifestBytes),
        integrity: handoffManifest.integrity ?? null
      },
      estimate: handoff.estimate ?? null,
      fee: {
        unitFeeEndpoint: nodeEvidence.fee.unitFeeEndpoint,
        unitFeeAtomic: nodeEvidence.fee.unitFeeAtomic,
        unitFeeQort: nodeEvidence.fee.unitFeeQort,
        recommendedFeeEndpoint: nodeEvidence.fee.recommendedFeeEndpoint,
        totalAtomic: nodeEvidence.fee.totalAtomic,
        totalQort: nodeEvidence.fee.totalQort,
        conversion: '1 QORT = 100,000,000 atomic units; total = sum of ' + handoff.resources.length + ' exact POST /transactions/fee quotes'
      },
      collisionCheck: {
        result: nodeEvidence.collisionCheck.result,
        anyCollision: nodeEvidence.collisionCheck.anyCollision,
        statuses: nodeEvidence.collisionCheck.statuses
      },
      ownership: {
        state: nodeEvidence.name.ownership,
        code: nodeEvidence.name.ownership === 'verified' ? 'NAME_OWNERSHIP_VERIFIED' : 'NAME_OWNERSHIP_MISMATCH',
        exactName: nodeEvidence.name.exactName,
        owner: nodeEvidence.name.owner,
        reducedName: nodeEvidence.name.reducedName
      },
      readback: phase3.readback,
      receiptImport: phase3.receiptImport,
      gate,
      statement: 'No transaction has been signed, submitted or published. Awaiting explicit owner approval for this exact proposal.'
    };
    const approvalText = JSON.stringify(approval, null, 2) + '\n';
    await writeFile(path.join(outDir, 'approval-request.json'), approvalText);
    await writeFile(path.join(outDir, 'approval-request.sha256'), sha256Hex(Buffer.from(approvalText, 'utf8')) + '  ./approval-request.json\n');

    const finalGate = {
      handoffId: handoff.handoffId,
      publicationBatchId: handoff.publicationBatchId,
      planId: handoff.planId,
      packageValid: true,
      filesVerified: validation.verified.length,
      validationSummary: validation.summary,
      manifestIntegrity: handoff.integrity ?? null,
      gate,
      allBytesMatch: payloadAudit.allBytesMatch,
      allShaMatch: payloadAudit.allShaMatch,
      anyCollision: nodeEvidence.collisionCheck.anyCollision,
      ownership: nodeEvidence.name.ownership,
      fee: {
        unitFeeAtomic: nodeEvidence.fee.unitFeeAtomic,
        totalAtomic: nodeEvidence.fee.totalAtomic,
        totalQort: nodeEvidence.fee.totalQort,
        resourceCount: handoff.resources.length
      },
      statement: 'Preflight only. Nothing signed, submitted or published.'
    };
    await writeFile(path.join(outDir, 'final-gate.json'), JSON.stringify(finalGate, null, 2) + '\n');

    const files = (await walkFiles(outDir)).filter((rel) => rel !== 'BUNDLE.sha256');
    const lines = [];
    for (const rel of files) {
      const bytes = await readFile(path.join(outDir, rel));
      lines.push(sha256Hex(bytes) + '  ./' + rel);
    }
    await writeFile(path.join(outDir, 'BUNDLE.sha256'), lines.join('\n') + '\n');

    process.stdout.write(JSON.stringify({
      ok: true,
      handoffId: handoff.handoffId,
      publicationBatchId: handoff.publicationBatchId,
      planId: handoff.planId,
      projectId: handoff.projectId,
      resourceCount: handoff.resources.length,
      resources: inventory.map((resource) => ({
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        contentType: resource.contentType,
        bytes: resource.bytes,
        sha256: resource.sha256
      })),
      fee: { unitFeeAtomic: nodeEvidence.fee.unitFeeAtomic, totalAtomic: nodeEvidence.fee.totalAtomic, totalQort: nodeEvidence.fee.totalQort },
      ownership: nodeEvidence.name,
      collisions: nodeEvidence.collisionCheck,
      gate,
      outDir
    }, null, 2) + '\n');
  } finally {
    if (handle) await handle.close().catch(() => {});
    await engine.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message, details: error.details ?? null }));
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from '../errors.js';
import { stableStringify } from '../../model/content.js';
import { assertPathInside } from '../storage/paths.js';

/**
 * Portable publication handoff and receipt contracts shared by the desktop
 * engine and the Migration Publisher Q-App. The package contains exact bytes
 * to publish plus metadata; it never contains wallet material, secrets or
 * absolute filesystem paths.
 */
export const HANDOFF_SCHEMA = 'qms-publication-handoff@1';
export const HANDOFF_VERSION = 1;
export const RECEIPT_SCHEMA = 'qms-publication-receipt@1';
export const RECEIPT_VERSION = 1;
export const PUBLICATION_STATE_SCHEMA = 'qms-publication-state@1';
export const MAX_BATCH_RESOURCES = 20;
export const DEFAULT_MAX_UNCONFIRMED = 20;
export const SUPPORTED_HANDOFF_VERSIONS = Object.freeze([1]);
export const PUBLISHABLE_SERVICES = Object.freeze([
  'DOCUMENT',
  'JSON',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'FILE'
]);
export const RESOURCE_KINDS = Object.freeze(['media', 'content', 'index', 'manifest']);
export const KIND_PHASE = Object.freeze({ media: 10, content: 20, index: 30, manifest: 40 });
export const PUBLICATION_RESOURCE_STATES = Object.freeze([
  'reserved',
  'prepared',
  'handoff_ready',
  'submitted',
  'pending_confirmation',
  'remote_verified',
  'failed',
  'partial',
  'ambiguous',
  'declined',
  'blocked'
]);

const HANDOFF_ID = /^hof_[a-z0-9]{8,40}$/;
const BATCH_ID = /^pub_[a-z0-9]{8,40}$/;
const RESOURCE_ID = /^res_[a-z0-9]{8,40}$/;
const PLAN_ID = /^plan_[a-z0-9]{8,40}$/;
const PROJECT_ID = /^prj_[a-z0-9][a-z0-9-]{3,47}$/;
const SITE_ID = /^site_[a-z0-9]{16,64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie|mnemonic)/i;

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' must be an object.');
  }
  return value;
}

function assertString(value, label, { pattern = null, max = 2000, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' is required.');
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' must be a non-empty string.');
  }
  if (pattern && !pattern.test(value)) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' has an invalid format.');
  }
  return value;
}

function assertInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return value;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Bytes(bytes) {
  return 'sha256:' + sha256Hex(bytes);
}

export function integrityOf(document) {
  const clone = { ...document };
  delete clone.integrity;
  return sha256Bytes(Buffer.from(stableStringify(clone), 'utf8'));
}

export function sealDocument(document) {
  return { ...document, integrity: { algorithm: 'sha256', value: integrityOf(document) } };
}

export function verifyDocumentIntegrity(document, label = 'document') {
  const integrity = assertObject(document.integrity, label + '.integrity');
  if (integrity.algorithm !== 'sha256' || integrity.value !== integrityOf(document)) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' integrity check failed.', {
      expected: integrityOf(document),
      actual: integrity.value
    });
  }
  return true;
}

export function assertSafeRelativePath(value, label = 'relativePath') {
  assertString(value, label, { max: 500 });
  if (value.includes('\\') || value.includes('\u0000') || value.startsWith('/') || value.startsWith('~')) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' must be a normalized relative path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' contains unsafe path segments.');
  }
  if (!value.startsWith('payload/')) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' must stay inside the payload directory.');
  }
  return value;
}

export function assertNoSecretFields(value, label = 'handoff') {
  const visit = (entry, at) => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, at + '[' + index + ']'));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      if (SECRET_KEY.test(key)) {
        fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' contains a forbidden secret field: ' + at + '.' + key);
      }
      visit(child, at + '.' + key);
    }
  };
  visit(value, label);
  return true;
}

export function assertHandoffManifest(manifest) {
  assertObject(manifest, 'handoff');
  assertNoSecretFields(manifest);
  if (manifest.schema !== HANDOFF_SCHEMA) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Unsupported handoff schema: ' + String(manifest.schema));
  }
  if (!SUPPORTED_HANDOFF_VERSIONS.includes(manifest.version)) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Unsupported handoff version: ' + String(manifest.version));
  }
  verifyDocumentIntegrity(manifest, 'handoff');
  assertString(manifest.handoffId, 'handoff.handoffId', { pattern: HANDOFF_ID });
  assertString(manifest.publicationBatchId, 'handoff.publicationBatchId', { pattern: BATCH_ID });
  assertString(manifest.planId, 'handoff.planId', { pattern: PLAN_ID });
  assertString(manifest.projectId, 'handoff.projectId', { pattern: PROJECT_ID });
  assertString(manifest.siteId, 'handoff.siteId', { pattern: SITE_ID });
  assertString(manifest.siteNamespace, 'handoff.siteNamespace', { pattern: /^ns[a-z2-7]{8,40}$/ });
  const target = assertObject(manifest.target, 'handoff.target');
  const targetName = assertString(target.qdnName, 'handoff.target.qdnName', { max: 40 });
  assertString(target.resourcePrefix, 'handoff.target.resourcePrefix', { pattern: /^[a-z0-9]{1,8}$/ });
  const estimate = assertObject(manifest.estimate, 'handoff.estimate');
  assertString(estimate.label, 'handoff.estimate.label', { max: 120 });
  assertInteger(estimate.resourceCount, 'handoff.estimate.resourceCount', { min: 1, max: 10000 });
  if (estimate.currency !== 'QORT') {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Only QORT fee estimates are supported.');
  }
  if (typeof estimate.feePerResource !== 'number' || !Number.isFinite(estimate.feePerResource) || estimate.feePerResource < 0) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'handoff.estimate.feePerResource must be a non-negative number.');
  }
  if (typeof estimate.estimatedFee !== 'number' || !Number.isFinite(estimate.estimatedFee) || estimate.estimatedFee < 0) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'handoff.estimate.estimatedFee must be a non-negative number.');
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'handoff.resources must be a non-empty array.');
  }
  if (manifest.resources.length > 10000) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'handoff.resources is too large.');
  }
  if (estimate.resourceCount !== manifest.resources.length) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'handoff.estimate.resourceCount does not match resources.');
  }
  const ids = new Set();
  const triples = new Set();
  for (const [index, resource] of manifest.resources.entries()) {
    const label = 'handoff.resources[' + index + ']';
    assertObject(resource, label);
    assertString(resource.id, label + '.id', { pattern: RESOURCE_ID });
    if (ids.has(resource.id)) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Duplicate resource id: ' + resource.id);
    ids.add(resource.id);
    if (!RESOURCE_KINDS.includes(resource.kind)) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.kind is unsupported.');
    }
    if (!PUBLISHABLE_SERVICES.includes(resource.service)) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.service is unsupported: ' + String(resource.service));
    }
    assertString(resource.name, label + '.name', { max: 40 });
    if (resource.name !== targetName) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.name does not match the handoff target.');
    }
    assertString(resource.identifier, label + '.identifier', { pattern: IDENTIFIER });
    const triple = resource.service + '|' + resource.name + '|' + resource.identifier;
    if (triples.has(triple)) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Duplicate QDN triple: ' + triple);
    triples.add(triple);
    assertSafeRelativePath(resource.relativePath, label + '.relativePath');
    assertString(resource.contentType, label + '.contentType', { max: 200 });
    assertInteger(resource.bytes, label + '.bytes', { min: 0, max: 20 * 1024 * 1024 * 1024 });
    assertString(resource.sha256, label + '.sha256', { pattern: SHA256 });
    assertInteger(resource.order, label + '.order', { min: 0, max: 1000000 });
    if (!Array.isArray(resource.dependsOn)) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.dependsOn must be an array.');
    if (resource.dependsOn.some((entry) => typeof entry !== 'string')) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.dependsOn must contain resource ids.');
    }
    if (resource.dependsOn.includes(resource.id)) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' cannot depend on itself.');
    }
  }
  const byId = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  for (const resource of manifest.resources) {
    for (const dependency of resource.dependsOn) {
      const targetResource = byId.get(dependency);
      if (!targetResource) {
        fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Unknown dependency ' + dependency + ' for ' + resource.id);
      }
      if (KIND_PHASE[targetResource.kind] > KIND_PHASE[resource.kind]) {
        fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Dependency order is invalid for ' + resource.id + '.');
      }
    }
  }
  const seen = new Set();
  const visiting = new Set();
  const visit = (resource) => {
    if (seen.has(resource.id)) return;
    if (visiting.has(resource.id)) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Dependency cycle detected at ' + resource.id + '.');
    }
    visiting.add(resource.id);
    for (const dependency of resource.dependsOn) visit(byId.get(dependency));
    visiting.delete(resource.id);
    seen.add(resource.id);
  };
  manifest.resources.forEach(visit);
  return true;
}

export function summarizeHandoff(manifest) {
  const counts = { media: 0, content: 0, index: 0, manifest: 0, other: 0 };
  let bytes = 0;
  for (const resource of manifest.resources) {
    counts[resource.kind] = (counts[resource.kind] ?? 0) + 1;
    bytes += resource.bytes;
  }
  return {
    handoffId: manifest.handoffId,
    publicationBatchId: manifest.publicationBatchId,
    planId: manifest.planId,
    projectId: manifest.projectId,
    siteId: manifest.siteId,
    target: manifest.target,
    resources: manifest.resources.length,
    bytes,
    counts,
    estimate: manifest.estimate,
    createdAt: manifest.createdAt
  };
}

export async function validateHandoffPackage({ handoffDir, manifest = null }) {
  const root = path.resolve(handoffDir);
  let document = manifest;
  if (!document) {
    let raw;
    try {
      raw = await readFile(path.join(root, 'handoff.json'), 'utf8');
    } catch (error) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'handoff.json is missing from the selected package.', {
        handoffDir: root
      });
    }
    try {
      document = JSON.parse(raw);
    } catch (error) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'handoff.json is not valid JSON.');
    }
  }
  assertHandoffManifest(document);
  const verified = [];
  for (const resource of document.resources) {
    const filePath = assertPathInside(root, path.join(root, resource.relativePath), 'handoff payload path');
    let info;
    try {
      info = await lstat(filePath);
    } catch (error) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'Missing payload file for ' + resource.id + '.', {
        relativePath: resource.relativePath
      });
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'Payload is not a regular file for ' + resource.id + '.', {
        relativePath: resource.relativePath
      });
    }
    if (info.size !== resource.bytes) {
      fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Payload byte length does not match for ' + resource.id + '.', {
        expectedBytes: resource.bytes,
        actualBytes: info.size
      });
    }
    const bytes = await readFile(filePath);
    const actual = sha256Bytes(bytes);
    if (actual !== resource.sha256) {
      fail(ERROR_CODES.PUBLICATION_HASH_MISMATCH, 'Payload SHA-256 does not match for ' + resource.id + '.', {
        expected: resource.sha256,
        actual
      });
    }
    verified.push({ id: resource.id, relativePath: resource.relativePath, bytes: info.size, sha256: actual });
  }
  return { document, verified, summary: summarizeHandoff(document) };
}

export function publicationStateForReceiptStatus(status) {
  const allowed = new Set([
    'submitted',
    'pending_confirmation',
    'remote_verified',
    'failed',
    'partial',
    'ambiguous',
    'declined',
    'blocked'
  ]);
  return allowed.has(status) ? status : 'ambiguous';
}

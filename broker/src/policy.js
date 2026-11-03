import { BrokerError, BROKER_ERROR, fail } from './errors.js';
import {
  assertExactKeys,
  assertInteger,
  assertObject,
  assertString,
  decodeBase64Strict,
  isSha256,
  sha256Bytes
} from './util.js';
import { assertHandoffManifest, HANDOFF_SCHEMA } from '../../lib/engine/publication/handoff.js';

export const REQUEST_SCHEMA = 'qms-test-publication-request@2';
const REQUEST_ID = /^req_[a-z0-9]{8,40}$/;
const PROJECT_ID = /^prj_[a-z0-9][a-z0-9-]{3,47}$/;
const RESOURCE_ID = /^res_[a-z0-9]{8,40}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const FORBIDDEN_HINTS = [
  'walletId',
  'nodeUrl',
  'password',
  'unsignedBytes',
  'privateKey',
  'seedPhrase',
  'nodeApiKey',
  'signature',
  'process'
];

function rejectSecretShapedFields(body) {
  const topLevel = Object.keys(body);
  const hinted = topLevel.filter((key) =>
    FORBIDDEN_HINTS.some((hint) => key.toLowerCase() === hint.toLowerCase())
  );
  if (hinted.length > 0) {
    fail(BROKER_ERROR.INVALID_REQUEST, 'The request must not contain signing or wallet fields: ' + hinted.join(', '));
  }
}

function validateTarget(target, config) {
  assertExactKeys(target, ['name', 'ownerAddress'], 'target');
  assertString(target.name, 'target.name', { max: 40 });
  if (target.name !== config.qortal.targetName) {
    fail(BROKER_ERROR.POLICY_NAME, 'Publication is restricted to the exact registered test name.');
  }
  assertString(target.ownerAddress, 'target.ownerAddress', { max: 60 });
  if (target.ownerAddress !== config.qortal.ownerAddress) {
    fail(BROKER_ERROR.POLICY_OWNER, 'The target owner address is not the configured test owner.');
  }
  return { name: target.name, ownerAddress: target.ownerAddress };
}

function compareHandoff(handoff, request, config) {
  if (!handoff) return null;
  assertObject(handoff, 'handoff');
  let manifest;
  try {
    assertHandoffManifest(handoff);
    manifest = handoff;
  } catch (error) {
    throw new BrokerError(BROKER_ERROR.HANDOFF_INVALID, 'The handoff manifest is invalid or its integrity seal does not match.', {
      cause: error.message
    });
  }
  if (manifest.schema !== HANDOFF_SCHEMA) {
    fail(BROKER_ERROR.HANDOFF_INVALID, 'Unsupported handoff schema.');
  }
  if (manifest.projectId !== request.projectId) {
    fail(BROKER_ERROR.HANDOFF_INVALID, 'The handoff projectId does not match the request.');
  }
  if (manifest.target.qdnName !== config.qortal.targetName) {
    fail(BROKER_ERROR.POLICY_NAME, 'The handoff targets a different Qortal name.');
  }
  if (manifest.resources.length !== request.resources.length) {
    fail(BROKER_ERROR.HANDOFF_INVALID, 'The handoff resource count does not match the request.');
  }
  const byId = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  for (const resource of request.resources) {
    const expected = byId.get(resource.id);
    if (!expected) fail(BROKER_ERROR.HANDOFF_INVALID, 'The handoff is missing resource ' + resource.id + '.');
    if (expected.service !== resource.service || expected.name !== request.target.name ||
        expected.identifier !== resource.identifier) {
      fail(BROKER_ERROR.HANDOFF_INVALID, 'The handoff resource identity does not match: ' + resource.id);
    }
    if (expected.sha256 !== resource.sha256 || expected.bytes !== resource.bytes) {
      fail(BROKER_ERROR.HASH_MISMATCH, 'The handoff hash or byte length does not match: ' + resource.id);
    }
  }
  return manifest.handoffId;
}

/**
 * Validate and normalize a publication request. This function is pure and
 * fail-closed: any unsupported field, service, name, identifier, content type,
 * hash, byte length or fee stops the request before budget is reserved.
 */
export function validatePublicationRequest({ body, config }) {
  assertObject(body, 'request');
  rejectSecretShapedFields(body);
  assertExactKeys(body, ['schema', 'requestId', 'projectId', 'target', 'resources', 'handoff'], 'request');
  if (body.schema !== REQUEST_SCHEMA) {
    fail(BROKER_ERROR.INVALID_REQUEST, 'Unsupported request schema: ' + String(body.schema));
  }
  const requestId = assertString(body.requestId, 'requestId', { pattern: REQUEST_ID, max: 44 });
  const projectId = assertString(body.projectId, 'projectId', { pattern: PROJECT_ID, max: 52 });
  const target = validateTarget(body.target, config);

  if (!Array.isArray(body.resources) || body.resources.length === 0) {
    fail(BROKER_ERROR.INVALID_REQUEST, 'resources must be a non-empty array.');
  }
  const maxResources = Math.min(config.policy.maxResourcesPerRequest, config.policy.maxTransactionsPerRequest);
  if (body.resources.length > maxResources) {
    fail(BROKER_ERROR.TOO_MANY_RESOURCES, 'resources exceeds the configured per-request maximum of ' + maxResources + '.');
  }

  const ids = new Set();
  const triples = new Set();
  const resources = [];
  let totalBytes = 0;
  for (const [index, entry] of body.resources.entries()) {
    const label = 'resources[' + index + ']';
    assertExactKeys(entry, ['id', 'service', 'identifier', 'contentType', 'bytes', 'sha256', 'dataBase64'], label);
    const id = assertString(entry.id, label + '.id', { pattern: RESOURCE_ID, max: 44 });
    if (ids.has(id)) fail(BROKER_ERROR.INVALID_REQUEST, 'Duplicate resource id: ' + id);
    ids.add(id);
    if (entry.service !== 'DOCUMENT') {
      fail(BROKER_ERROR.POLICY_SERVICE, label + '.service is not allowed; Phase 5.2 allows DOCUMENT only.');
    }
    const identifier = assertString(entry.identifier, label + '.identifier', { pattern: IDENTIFIER, max: 64 });
    if (identifier.length < config.policy.minIdentifierLength || identifier.length > config.policy.maxIdentifierLength) {
      fail(BROKER_ERROR.POLICY_IDENTIFIER, label + '.identifier length is outside the configured range.');
    }
    if (!identifier.startsWith(config.policy.identifierPrefix) ||
        identifier.length <= config.policy.identifierPrefix.length) {
      fail(BROKER_ERROR.POLICY_IDENTIFIER, label + '.identifier must start with the configured development prefix and include a suffix.');
    }
    if (!config.policy.allowedContentTypes.includes(entry.contentType)) {
      fail(BROKER_ERROR.POLICY_CONTENT_TYPE, label + '.contentType is not allowed: ' + String(entry.contentType));
    }
    const bytes = assertInteger(entry.bytes, label + '.bytes', { min: 1, max: 20 * 1024 * 1024 * 1024 });
    if (bytes > config.policy.maxPayloadBytes) {
      fail(BROKER_ERROR.PAYLOAD_TOO_LARGE, label + '.bytes exceeds the configured payload limit.');
    }
    if (!isSha256(entry.sha256)) {
      fail(BROKER_ERROR.INVALID_REQUEST, label + '.sha256 must be sha256:<64 lowercase hex>.');
    }
    const decoded = decodeBase64Strict(entry.dataBase64, label + '.dataBase64', config.policy.maxPayloadBytes);
    if (decoded.length !== bytes) {
      fail(BROKER_ERROR.HASH_MISMATCH, label + '.bytes does not match the decoded payload length.');
    }
    const actualHash = sha256Bytes(decoded);
    if (actualHash !== entry.sha256) {
      fail(BROKER_ERROR.HASH_MISMATCH, label + '.sha256 does not match the decoded payload.');
    }
    totalBytes += decoded.length;
    if (totalBytes > config.policy.maxTotalBytesPerRequest) {
      fail(BROKER_ERROR.PAYLOAD_TOO_LARGE, 'The total payload exceeds the configured per-request limit.');
    }
    const triple = 'DOCUMENT|' + target.name + '|' + identifier;
    if (triples.has(triple)) fail(BROKER_ERROR.INVALID_REQUEST, 'Duplicate QDN resource identity: ' + identifier);
    triples.add(triple);
    resources.push({
      id,
      service: 'DOCUMENT',
      identifier,
      contentType: entry.contentType,
      bytes,
      sha256: entry.sha256,
      dataBase64: entry.dataBase64,
      bytesBuffer: decoded
    });
  }

  const handoffId = compareHandoff(body.handoff, { requestId, projectId, target, resources }, config);

  return {
    schema: REQUEST_SCHEMA,
    requestId,
    projectId,
    targetName: target.name,
    ownerAddress: target.ownerAddress,
    resources,
    totalBytes,
    handoffId
  };
}

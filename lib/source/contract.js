import { SourceError, SOURCE_ERROR_CODES } from './errors.js';

export const SOURCE_ADAPTER_CONTRACT = 'qms-source-adapter@1';
export const SOURCE_ADAPTER_CONTRACT_VERSION = 1;

const REQUIRED_ADAPTER_FIELDS = ['id', 'displayName', 'version', 'contractVersion'];
const REQUIRED_SESSION_METHODS = [
  'validate',
  'listContent',
  'listTerms',
  'listAssets',
  'normalizeContent',
  'normalizeTerm',
  'normalizeAsset',
  'close'
];

const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

/**
 * Capability report shape shared by every adapter. Values are data only; the UI
 * must not infer support from the adapter id.
 */
export function normalizeCapabilities(input = {}) {
  const capabilities = {
    contract: SOURCE_ADAPTER_CONTRACT,
    contractVersion: SOURCE_ADAPTER_CONTRACT_VERSION,
    contentTypes: Array.isArray(input.contentTypes) ? [...new Set(input.contentTypes.map(String))] : [],
    terms: Array.isArray(input.terms) ? [...new Set(input.terms.map(String))] : [],
    assets: {
      images: Boolean(input.assets?.images),
      audio: Boolean(input.assets?.audio),
      video: Boolean(input.assets?.video),
      documents: Boolean(input.assets?.documents),
      embeds: Boolean(input.assets?.embeds)
    },
    states: Array.isArray(input.states) ? [...new Set(input.states.map(String))] : [],
    incremental: {
      new: Boolean(input.incremental?.new),
      modified: Boolean(input.incremental?.modified),
      deleted: Boolean(input.incremental?.deleted),
      cursor: ['offset', 'date', 'id', 'etag', 'none'].includes(input.incremental?.cursor)
        ? input.incremental.cursor
        : 'none'
    },
    authentication: Array.isArray(input.authentication) ? [...new Set(input.authentication.map(String))] : ['none'],
    limits: {
      maxPageSize: Number.isInteger(input.limits?.maxPageSize) && input.limits.maxPageSize > 0
        ? input.limits.maxPageSize
        : 100,
      supportsDateFilters: Boolean(input.limits?.supportsDateFilters),
      supportsModifiedFilters: Boolean(input.limits?.supportsModifiedFilters),
      supportsOffset: Boolean(input.limits?.supportsOffset),
      boundedMemory: input.limits?.boundedMemory !== false
    },
    unsupported: input.unsupported && typeof input.unsupported === 'object'
      ? { ...input.unsupported }
      : {}
  };
  return capabilities;
}

export function assertSourceAdapter(adapter) {
  const fail = (reason) => {
    throw new SourceError(
      SOURCE_ERROR_CODES.CONTRACT_VIOLATION,
      `Invalid source adapter: ${reason}`,
      { details: { reason } }
    );
  };
  if (!adapter || typeof adapter !== 'object') fail('adapter must be an object');
  for (const field of REQUIRED_ADAPTER_FIELDS) {
    if (adapter[field] === undefined || adapter[field] === null || adapter[field] === '') {
      fail(`missing ${field}`);
    }
  }
  if (!ADAPTER_ID_PATTERN.test(String(adapter.id))) fail('id must match ^[a-z0-9][a-z0-9-]{1,31}$');
  if (adapter.contractVersion !== SOURCE_ADAPTER_CONTRACT_VERSION) {
    fail(`unsupported contract version ${adapter.contractVersion}`);
  }
  if (typeof adapter.getCapabilities !== 'function') fail('getCapabilities is required');
  if (typeof adapter.createSession !== 'function') fail('createSession is required');
  const capabilities = adapter.getCapabilities();
  if (!capabilities || typeof capabilities !== 'object') fail('getCapabilities must return an object');
  return adapter;
}

export function assertSourceSession(session) {
  const fail = (reason) => {
    throw new SourceError(
      SOURCE_ERROR_CODES.CONTRACT_VIOLATION,
      `Invalid source session: ${reason}`,
      { details: { reason } }
    );
  };
  if (!session || typeof session !== 'object') fail('session must be an object');
  for (const method of REQUIRED_SESSION_METHODS) {
    if (typeof session[method] !== 'function') fail(`missing ${method}`);
  }
  return session;
}

/** Validate an adapter with an in-process fake session before registration. */
export function describeAdapter(adapter) {
  assertSourceAdapter(adapter);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    version: adapter.version,
    contract: SOURCE_ADAPTER_CONTRACT,
    contractVersion: adapter.contractVersion,
    capabilities: normalizeCapabilities(adapter.getCapabilities())
  };
}

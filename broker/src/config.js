import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { BrokerError, BROKER_ERROR } from './errors.js';
import { qortToAtomic } from './amounts.js';

export const REQUIRED_TARGET_NAME = 'developer iffi';
export const EXPECTED_TEST_OWNER = 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E';

const NAME_IDENTIFIER = /^[a-z0-9][a-z0-9-]{1,31}$/;
const IP_HOSTS = new Set(['localhost']);

function fail(message) {
  throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'Configuration error: ' + message);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object.');
  return value;
}

function requireString(value, label, { pattern = null, max = 2000 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail(label + ' must be a non-empty string.');
  }
  if (pattern && !pattern.test(value)) fail(label + ' has an invalid format.');
  return value;
}

function requireInteger(value, label, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) fail(label + ' must be an integer between ' + min + ' and ' + max + '.');
  return value;
}

function parseUrl(value, label, { loopbackOnly = false } = {}) {
  let url;
  try {
    url = new URL(requireString(value, label));
  } catch (error) {
    if (error instanceof BrokerError) throw error;
    fail(label + ' is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail(label + ' must use http or https.');
  if (url.username || url.password || url.search || url.hash) fail(label + ' must not contain credentials, a query or a fragment.');
  if (loopbackOnly) {
    const host = url.hostname;
    const allowed = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
    if (!allowed) fail(label + ' must point at loopback for the signing backend.');
  }
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

function isPrivateOrLoopbackHost(host) {
  if (host === 'localhost' || host === '::1') return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

function validateBindHost(host) {
  requireString(host, 'server.host', { max: 100 });
  if (!isPrivateOrLoopbackHost(host)) {
    fail('server.host must be loopback or a private RFC1918 address; the broker API must never be public.');
  }
  return host;
}

export function defaultConfig() {
  return {
    server: {
      host: '127.0.0.1',
      port: 3199,
      requestTimeoutMs: 30000,
      headersTimeoutMs: 10000,
      maxBodyBytes: 8 * 1024 * 1024,
      maxConcurrentPublications: 1
    },
    admin: {
      socketPath: '/run/qms-qdn-test-broker/admin.sock',
      enabled: true
    },
    qortal: {
      nodeUrl: 'http://127.0.0.1:12391',
      targetName: REQUIRED_TARGET_NAME,
      ownerAddress: EXPECTED_TEST_OWNER,
      nameCheckTtlMs: 60000,
      feeTimeoutMs: 10000
    },
    policy: {
      allowedServices: ['DOCUMENT'],
      allowedContentTypes: ['text/plain', 'text/markdown', 'text/html', 'application/json'],
      identifierPrefix: 'qms-dev-',
      maxResourcesPerRequest: 20,
      maxTransactionsPerRequest: 20,
      maxPayloadBytes: 1024 * 1024,
      maxTotalBytesPerRequest: 4 * 1024 * 1024,
      budgetQort: '5',
      walletReserveQort: '0.1',
      budgetWindowMs: 86400000,
      sessionLifetimeMs: 3600000,
      allowResourceUpdates: false,
      minIdentifierLength: 8,
      maxIdentifierLength: 64
    },
    signing: {
      backend: 'external-auth',
      externalAuth: {
        baseUrl: 'http://127.0.0.1:3191',
        walletId: '',
        tokenFile: '/etc/qms-qdn-test-broker/external-auth-token',
        timeoutMs: 60000,
        expectedAddress: EXPECTED_TEST_OWNER
      }
    },
    auth: {
      keysFile: '/etc/qms-qdn-test-broker/clients.json',
      clockSkewMs: 120000,
      nonceTtlMs: 600000,
      maxRequestAgeMs: 120000
    },
    audit: {
      path: '/var/lib/qms-qdn-test-broker/audit.jsonl'
    },
    state: {
      path: '/var/lib/qms-qdn-test-broker/state.json',
      fsync: true
    },
    killSwitch: {
      path: '/var/lib/qms-qdn-test-broker/DISABLED'
    },
    readback: {
      attempts: 4,
      intervalMs: 1500,
      timeoutMs: 20000
    }
  };
}

export function validateConfig(input) {
  const raw = requireObject(input, 'config');
  const cfg = structuredClone(raw);
  const defaults = defaultConfig();

  cfg.server = requireObject(cfg.server ?? defaults.server, 'server');
  cfg.server.host = validateBindHost(cfg.server.host ?? defaults.server.host);
  cfg.server.port = requireInteger(cfg.server.port ?? defaults.server.port, 'server.port', { min: 1, max: 65535 });
  cfg.server.requestTimeoutMs = requireInteger(cfg.server.requestTimeoutMs ?? defaults.server.requestTimeoutMs, 'server.requestTimeoutMs', { min: 1000, max: 120000 });
  cfg.server.headersTimeoutMs = requireInteger(cfg.server.headersTimeoutMs ?? defaults.server.headersTimeoutMs, 'server.headersTimeoutMs', { min: 1000, max: 60000 });
  cfg.server.maxBodyBytes = requireInteger(cfg.server.maxBodyBytes ?? defaults.server.maxBodyBytes, 'server.maxBodyBytes', { min: 1024, max: 64 * 1024 * 1024 });
  cfg.server.maxConcurrentPublications = requireInteger(cfg.server.maxConcurrentPublications ?? defaults.server.maxConcurrentPublications, 'server.maxConcurrentPublications', { min: 1, max: 4 });

  cfg.admin = requireObject(cfg.admin ?? defaults.admin, 'admin');
  cfg.admin.enabled = cfg.admin.enabled !== false;
  if (cfg.admin.enabled) {
    const socket = requireString(cfg.admin.socketPath ?? defaults.admin.socketPath, 'admin.socketPath', { max: 300 });
    if (!socket.startsWith('/')) fail('admin.socketPath must be absolute.');
    cfg.admin.socketPath = socket;
  }

  cfg.qortal = requireObject(cfg.qortal ?? defaults.qortal, 'qortal');
  cfg.qortal.nodeUrl = parseUrl(cfg.qortal.nodeUrl ?? defaults.qortal.nodeUrl, 'qortal.nodeUrl');
  const targetName = requireString(cfg.qortal.targetName ?? defaults.qortal.targetName, 'qortal.targetName', { max: 40 });
  if (targetName !== REQUIRED_TARGET_NAME) {
    fail('qortal.targetName must be the exact registered test name "' + REQUIRED_TARGET_NAME + '".');
  }
  cfg.qortal.targetName = targetName;
  const owner = requireString(cfg.qortal.ownerAddress ?? defaults.qortal.ownerAddress, 'qortal.ownerAddress', { max: 60 });
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,50}$/.test(owner)) fail('qortal.ownerAddress is not a Qortal address.');
  cfg.qortal.ownerAddress = owner;
  cfg.qortal.nameCheckTtlMs = requireInteger(cfg.qortal.nameCheckTtlMs ?? defaults.qortal.nameCheckTtlMs, 'qortal.nameCheckTtlMs', { min: 0, max: 3600000 });
  cfg.qortal.feeTimeoutMs = requireInteger(cfg.qortal.feeTimeoutMs ?? defaults.qortal.feeTimeoutMs, 'qortal.feeTimeoutMs', { min: 1000, max: 60000 });

  cfg.policy = requireObject(cfg.policy ?? defaults.policy, 'policy');
  const p = cfg.policy;
  if (!Array.isArray(p.allowedServices) || p.allowedServices.length !== 1 || p.allowedServices[0] !== 'DOCUMENT') {
    fail('policy.allowedServices must be exactly ["DOCUMENT"] in Phase 5.2.');
  }
  p.allowedServices = ['DOCUMENT'];
  if (!Array.isArray(p.allowedContentTypes) || p.allowedContentTypes.length === 0 || p.allowedContentTypes.length > 20) {
    fail('policy.allowedContentTypes must be a non-empty array.');
  }
  for (const type of p.allowedContentTypes) {
    requireString(type, 'policy.allowedContentTypes[]', { max: 100 });
    if (!/^(text\/[a-z0-9.+-]+|application\/json)$/.test(type)) fail('policy.allowedContentTypes contains an unsupported type: ' + type);
  }
  p.identifierPrefix = requireString(p.identifierPrefix, 'policy.identifierPrefix', { pattern: NAME_IDENTIFIER, max: 32 });
  p.maxResourcesPerRequest = requireInteger(p.maxResourcesPerRequest, 'policy.maxResourcesPerRequest', { min: 1, max: 20 });
  p.maxTransactionsPerRequest = requireInteger(p.maxTransactionsPerRequest, 'policy.maxTransactionsPerRequest', { min: 1, max: 20 });
  p.maxPayloadBytes = requireInteger(p.maxPayloadBytes, 'policy.maxPayloadBytes', { min: 1, max: 20 * 1024 * 1024 });
  p.maxTotalBytesPerRequest = requireInteger(p.maxTotalBytesPerRequest, 'policy.maxTotalBytesPerRequest', { min: 1, max: 64 * 1024 * 1024 });
  if (Object.prototype.hasOwnProperty.call(p, 'maxFeePerTransactionQort')) {
    fail('policy.maxFeePerTransactionQort is no longer supported; fees are derived from the node per resource.');
  }
  p.budgetAtomic = qortToAtomic(p.budgetQort ?? defaults.policy.budgetQort, 'policy.budgetQort');
  p.walletReserveAtomic = qortToAtomic(p.walletReserveQort ?? defaults.policy.walletReserveQort, 'policy.walletReserveQort');
  if (p.budgetAtomic <= 0) fail('policy.budgetQort must be positive.');
  if (p.walletReserveAtomic < 0) fail('policy.walletReserveQort must not be negative.');
  if (p.walletReserveAtomic >= p.budgetAtomic) fail('policy.walletReserveQort must be smaller than policy.budgetQort.');
  p.budgetWindowMs = requireInteger(p.budgetWindowMs ?? defaults.policy.budgetWindowMs, 'policy.budgetWindowMs', { min: 60000, max: 30 * 86400000 });
  p.sessionLifetimeMs = requireInteger(p.sessionLifetimeMs ?? defaults.policy.sessionLifetimeMs, 'policy.sessionLifetimeMs', { min: 60000, max: 30 * 86400000 });
  p.allowResourceUpdates = p.allowResourceUpdates === true;
  p.minIdentifierLength = requireInteger(p.minIdentifierLength ?? defaults.policy.minIdentifierLength, 'policy.minIdentifierLength', { min: 4, max: 64 });
  p.maxIdentifierLength = requireInteger(p.maxIdentifierLength ?? defaults.policy.maxIdentifierLength, 'policy.maxIdentifierLength', { min: p.minIdentifierLength, max: 64 });

  cfg.signing = requireObject(cfg.signing ?? defaults.signing, 'signing');
  if (!['external-auth', 'mock'].includes(cfg.signing.backend)) fail('signing.backend must be external-auth or mock.');
  cfg.signing.externalAuth = requireObject(cfg.signing.externalAuth ?? defaults.signing.externalAuth, 'signing.externalAuth');
  cfg.signing.externalAuth.baseUrl = parseUrl(cfg.signing.externalAuth.baseUrl, 'signing.externalAuth.baseUrl', { loopbackOnly: true });
  cfg.signing.externalAuth.walletId = requireString(cfg.signing.externalAuth.walletId, 'signing.externalAuth.walletId', { max: 200 });
  cfg.signing.externalAuth.tokenFile = requireString(cfg.signing.externalAuth.tokenFile, 'signing.externalAuth.tokenFile', { max: 300 });
  cfg.signing.externalAuth.timeoutMs = requireInteger(cfg.signing.externalAuth.timeoutMs, 'signing.externalAuth.timeoutMs', { min: 1000, max: 120000 });
  const expectedAddress = requireString(cfg.signing.externalAuth.expectedAddress, 'signing.externalAuth.expectedAddress', { max: 60 });
  if (expectedAddress !== cfg.qortal.ownerAddress) {
    fail('signing.externalAuth.expectedAddress must equal qortal.ownerAddress.');
  }

  cfg.auth = requireObject(cfg.auth ?? defaults.auth, 'auth');
  cfg.auth.keysFile = requireString(cfg.auth.keysFile, 'auth.keysFile', { max: 300 });
  cfg.auth.clockSkewMs = requireInteger(cfg.auth.clockSkewMs ?? defaults.auth.clockSkewMs, 'auth.clockSkewMs', { min: 1000, max: 600000 });
  cfg.auth.nonceTtlMs = requireInteger(cfg.auth.nonceTtlMs ?? defaults.auth.nonceTtlMs, 'auth.nonceTtlMs', { min: 1000, max: 86400000 });
  cfg.auth.maxRequestAgeMs = requireInteger(cfg.auth.maxRequestAgeMs ?? defaults.auth.maxRequestAgeMs, 'auth.maxRequestAgeMs', { min: 1000, max: 600000 });

  cfg.audit = requireObject(cfg.audit ?? defaults.audit, 'audit');
  cfg.audit.path = requireString(cfg.audit.path, 'audit.path', { max: 300 });
  cfg.state = requireObject(cfg.state ?? defaults.state, 'state');
  cfg.state.path = requireString(cfg.state.path, 'state.path', { max: 300 });
  cfg.state.fsync = cfg.state.fsync !== false;
  cfg.killSwitch = requireObject(cfg.killSwitch ?? defaults.killSwitch, 'killSwitch');
  cfg.killSwitch.path = requireString(cfg.killSwitch.path, 'killSwitch.path', { max: 300 });
  cfg.readback = requireObject(cfg.readback ?? defaults.readback, 'readback');
  cfg.readback.attempts = requireInteger(cfg.readback.attempts, 'readback.attempts', { min: 1, max: 20 });
  cfg.readback.intervalMs = requireInteger(cfg.readback.intervalMs, 'readback.intervalMs', { min: 0, max: 30000 });
  cfg.readback.timeoutMs = requireInteger(cfg.readback.timeoutMs, 'readback.timeoutMs', { min: 1000, max: 60000 });
  return cfg;
}

export function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'Unable to read configuration file.', { cause: error.message });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'Configuration file is not valid JSON.');
  }
  return validateConfig(parsed);
}

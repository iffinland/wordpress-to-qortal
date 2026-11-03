import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { BrokerError, BROKER_ERROR } from './errors.js';

export const STATE_SCHEMA = 'qms-test-broker-state@3';
export const STATE_VERSION = 3;
export const LEGACY_STATE_SCHEMA_V1 = 'qms-test-broker-state@1';
export const LEGACY_STATE_SCHEMA_V2 = 'qms-test-broker-state@2';

function emptyState(now) {
  return {
    schema: STATE_SCHEMA,
    version: STATE_VERSION,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    disabled: false,
    disabledAt: null,
    disabledReason: null,
    revokedKeys: [],
    requestNonces: {},
    publications: {},
    idempotency: {},
    resourceLocks: {},
    budget: {
      windowStart: now,
      spentAtomic: 0,
      uncertainAtomic: 0,
      reservations: {}
    }
  };
}

/**
 * Upgrade older state without touching publications, idempotency, resource
 * locks, budget, reservations or audit data.
 *
 * v1 -> v3: the obsolete access-grant map is absent; add requestNonces.
 * v2 -> v3: the obsolete accessGrants map is dropped and requestNonces is added.
 *
 * Durable request nonces are pruned by expiry at startup and on every claim.
 */
export function migrateState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const isV1 = data.schema === LEGACY_STATE_SCHEMA_V1 && data.version === 1;
  const isV2 = data.schema === LEGACY_STATE_SCHEMA_V2 && data.version === 2;
  if (!isV1 && !isV2) return data;
  const { accessGrants: _droppedGrants, ...rest } = data;
  return {
    ...rest,
    schema: STATE_SCHEMA,
    version: STATE_VERSION,
    requestNonces: data.requestNonces && typeof data.requestNonces === 'object' && !Array.isArray(data.requestNonces)
      ? data.requestNonces
      : {}
  };
}

function validateState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker state is not an object.');
  }
  if (data.schema !== STATE_SCHEMA || data.version !== STATE_VERSION) {
    throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker state schema is unsupported.');
  }
  for (const field of ['publications', 'idempotency', 'resourceLocks', 'budget', 'requestNonces']) {
    if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker state field is invalid: ' + field);
    }
  }
  if (!Array.isArray(data.revokedKeys)) {
    throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker state revokedKeys is invalid.');
  }
  if (!Number.isSafeInteger(data.budget.spentAtomic) || data.budget.spentAtomic < 0) {
    throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker budget state is invalid.');
  }
  for (const [key, entry] of Object.entries(data.requestNonces)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}\|[A-Za-z0-9_-]{16,128}$/.test(key)) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker request nonce state is invalid.');
    }
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.expiresAt)) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker request nonce entry is invalid.');
    }
  }
  if (!data.budget.reservations || typeof data.budget.reservations !== 'object' || Array.isArray(data.budget.reservations)) {
    throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker budget reservations are invalid.');
  }
  return data;
}

export class BrokerState {
  constructor({ path, clock = () => Date.now(), fsync = true }) {
    this.path = path;
    this.clock = clock;
    this.fsync = fsync;
    this.data = null;
    this._queue = Promise.resolve();
  }

  static open(options) {
    const instance = new BrokerState(options);
    return instance.init();
  }

  async init() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const now = this.clock();
    if (!existsSync(this.path)) {
      this.data = emptyState(now);
      await this.persist();
      return this;
    }
    let raw;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Unable to read broker state.', { cause: error.message });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'Broker state is not valid JSON; refusing to start.');
    }
    const migrated = migrateState(parsed);
    this.data = validateState(migrated);
    if (parsed.schema !== migrated.schema || parsed.version !== migrated.version) {
      await this.persist();
    }
    return this;
  }

  /**
   * A single serialized transaction boundary. Concurrent publication requests
   * cannot double-spend the fee budget, claim the same QDN triple or claim the
   * same request nonce.
   */
  transact(fn) {
    const run = this._queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await fn(draft);
      draft.updatedAt = new Date(this.clock()).toISOString();
      this.data = validateState(draft);
      await this.persist();
      return result;
    });
    this._queue = run.catch(() => {});
    return run;
  }

  snapshot() {
    return structuredClone(this.data);
  }

  publicationCount() {
    return Object.keys(this.data.publications).length;
  }

  /**
   * Atomically record a request nonce. Returns false when the same keyId/nonce
   * pair was already used inside its retention window, including before a
   * broker restart.
   */
  async claimNonce({ keyId, nonce, expiresAt, now = this.clock() }) {
    return this.transact((draft) => {
      for (const [key, entry] of Object.entries(draft.requestNonces)) {
        if (!entry || entry.expiresAt <= now) delete draft.requestNonces[key];
      }
      const key = keyId + '|' + nonce;
      if (draft.requestNonces[key]) return false;
      draft.requestNonces[key] = { expiresAt };
      return true;
    });
  }

  async persist() {
    const json = JSON.stringify(this.data, null, 0) + '\n';
    const tmp = this.path + '.tmp-' + process.pid;
    writeFileSync(tmp, json, { mode: 0o600 });
    if (this.fsync) {
      const fd = openSync(tmp, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    renameSync(tmp, this.path);
  }

  /**
   * Crash recovery: any reservation that survived a process restart may have
   * been signed before the crash. Count it as spent rather than silently
   * restoring the budget. It is never retried automatically. Expired replay
   * entries are dropped; live ones keep the window closed across restart.
   */
  async recoverInterrupted({ windowMs = 86400000 } = {}) {
    return this.transact((draft) => {
      const now = this.clock();
      rollWindow(draft, now, windowMs);
      for (const [key, entry] of Object.entries(draft.requestNonces)) {
        if (!entry || entry.expiresAt <= now) delete draft.requestNonces[key];
      }
      let recovered = 0;
      for (const publication of Object.values(draft.publications)) {
        if (publication.state === 'reserved' || publication.state === 'submitting') {
          const charged = Number(publication.reservedAtomic || 0);
          draft.budget.spentAtomic += charged;
          publication.state = 'ambiguous';
          publication.decision = 'ambiguous';
          publication.code = 'BROKER_RESTART_INTERRUPTED';
          publication.message = 'The broker restarted while publication was in flight; the outcome is unknown.';
          publication.chargedAtomic = charged;
          publication.reservedAtomic = 0;
          publication.updatedAt = new Date(now).toISOString();
          recovered += 1;
        }
      }
      // Any surviving reservation is either already represented by an
      // interrupted publication above or belongs to a request that never
      // reached submission. In both cases it must not hold budget forever.
      draft.budget.reservations = {};
      return { recovered };
    });
  }
}

export function windowSpent(data, now, windowMs) {
  const start = Number(data.budget.windowStart || 0);
  if (!Number.isFinite(start) || now - start >= windowMs || now < start) {
    return 0;
  }
  const reserved = Object.values(data.budget.reservations || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  return Number(data.budget.spentAtomic || 0) + Number(data.budget.uncertainAtomic || 0) + reserved;
}

export function rollWindow(draft, now, windowMs) {
  const start = Number(draft.budget.windowStart || 0);
  if (!Number.isFinite(start) || now - start >= windowMs || now < start) {
    draft.budget.windowStart = now;
    draft.budget.spentAtomic = 0;
    draft.budget.uncertainAtomic = 0;
  }
}

export function resourceKey(resource) {
  return resource.service + '|' + resource.name + '|' + resource.identifier;
}

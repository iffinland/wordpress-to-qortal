import { QmsError, ERROR_CODES } from '../errors.js';

export const STATE_SNAPSHOT_SCHEMA = 'qms-state-snapshot@1';
export const STATE_SCHEMA = 'qms-state@1';
export const JOURNAL_SCHEMA = 'qms-journal@1';
export const PROJECT_SCHEMA = 'qms-project@1';

/** Current persistent store version. Forward-only migrations below. */
export const CURRENT_STORE_VERSION = 1;

export const PROJECT_VERSION = 1;

export function createInitialState({ projectId, createdAt }) {
  return {
    schema: STATE_SCHEMA,
    projectId,
    createdAt,
    updatedAt: createdAt,
    lastEventSeq: 0,
    eventsDropped: 0,
    events: [],
    runs: {},
    counters: { run: 0 },
    meta: {}
  };
}

function baseEventLogNormalization(state) {
  state.events = Array.isArray(state.events) ? state.events : [];
  state.eventsDropped = Number.isInteger(state.eventsDropped) ? state.eventsDropped : 0;
  state.runs = state.runs && typeof state.runs === 'object' ? state.runs : {};
  state.counters = state.counters && typeof state.counters === 'object' ? state.counters : {};
  state.counters.run = Number.isInteger(state.counters.run) ? state.counters.run : 0;
  state.lastEventSeq = Number.isInteger(state.lastEventSeq) ? state.lastEventSeq : 0;
  state.meta = state.meta && typeof state.meta === 'object' ? state.meta : {};
  return state;
}

/**
 * Forward-only migrations keyed by the version they upgrade FROM.
 * Each migration receives a deep clone and must return the upgraded state.
 */
export const STATE_MIGRATIONS = Object.freeze({
  0(state) {
    // Version 0 documented legacy snapshot: no explicit schema/run index.
    const migrated = baseEventLogNormalization(state);
    migrated.schema = STATE_SCHEMA;
    migrated.runs = migrated.runs ?? {};
    for (const run of Object.values(migrated.runs)) {
      run.events = Array.isArray(run.events) ? run.events : [];
      run.lastEventSeq = Number.isInteger(run.lastEventSeq) ? run.lastEventSeq : 0;
    }
    return migrated;
  }
});

export function assertSupportedStoreVersion(storeVersion, { file } = {}) {
  if (!Number.isInteger(storeVersion) || storeVersion < 0) {
    throw new QmsError(ERROR_CODES.STATE_VERSION_UNSUPPORTED, 'State store version is invalid.', {
      details: { storeVersion, file }
    });
  }
  if (storeVersion > CURRENT_STORE_VERSION) {
    throw new QmsError(
      ERROR_CODES.STATE_VERSION_UNSUPPORTED,
      `Project state requires a newer Qortal Migration Studio (store version ${storeVersion}, supported ${CURRENT_STORE_VERSION}). Refusing to modify it.`,
      { details: { storeVersion, supported: CURRENT_STORE_VERSION, file } }
    );
  }
  return storeVersion;
}

export function migrateState(state, fromVersion, { migrations = STATE_MIGRATIONS, targetVersion = CURRENT_STORE_VERSION } = {}) {
  let current = state;
  let version = fromVersion;
  const applied = [];
  while (version < targetVersion) {
    const migration = migrations[version];
    if (typeof migration !== 'function') {
      throw new QmsError(
        ERROR_CODES.STATE_VERSION_UNSUPPORTED,
        `No migration path from store version ${version} to ${targetVersion}.`,
        { details: { fromVersion: version, targetVersion } }
      );
    }
    current = migration(structuredClone(current));
    version += 1;
    applied.push(version);
  }
  return { state: current, storeVersion: version, applied };
}

export function validateState(state, { file } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State document is not an object.', {
      details: { file }
    });
  }
  if (state.schema !== STATE_SCHEMA) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, `Unsupported state schema: ${state.schema}`, {
      details: { file, schema: state.schema }
    });
  }
  if (!Number.isInteger(state.lastEventSeq) || state.lastEventSeq < 0) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State event sequence is invalid.', {
      details: { file }
    });
  }
  if (!state.runs || typeof state.runs !== 'object' || Array.isArray(state.runs)) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State runs index is invalid.', {
      details: { file }
    });
  }
  return state;
}

export function validateSnapshot(snapshot, { file } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State snapshot is not an object.', {
      details: { file }
    });
  }
  if (snapshot.schema !== STATE_SNAPSHOT_SCHEMA) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, `Unsupported snapshot schema: ${snapshot.schema}`, {
      details: { file }
    });
  }
  if (!Number.isInteger(snapshot.storeVersion)) {
    throw new QmsError(ERROR_CODES.STATE_VERSION_UNSUPPORTED, 'Snapshot store version is invalid.', {
      details: { file, storeVersion: snapshot.storeVersion }
    });
  }
  if (!Number.isInteger(snapshot.lastTxnSeq) || snapshot.lastTxnSeq < 0) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'Snapshot transaction sequence is invalid.', {
      details: { file }
    });
  }
  validateState(snapshot.state, { file });
  return snapshot;
}

export function assertProjectDocument(document, { file } = {}) {
  if (!document || typeof document !== 'object') {
    throw new QmsError(ERROR_CODES.PROJECT_SCHEMA_UNSUPPORTED, 'Project document is not an object.', {
      details: { file }
    });
  }
  if (document.schema !== PROJECT_SCHEMA) {
    throw new QmsError(ERROR_CODES.PROJECT_SCHEMA_UNSUPPORTED, `Unsupported project schema: ${document.schema}`, {
      details: { file, schema: document.schema }
    });
  }
  if (!Number.isInteger(document.version) || document.version < 1) {
    throw new QmsError(ERROR_CODES.PROJECT_SCHEMA_UNSUPPORTED, 'Project document version is invalid.', {
      details: { file, version: document.version }
    });
  }
  if (document.version > PROJECT_VERSION) {
    throw new QmsError(
      ERROR_CODES.PROJECT_SCHEMA_UNSUPPORTED,
      `Project requires a newer Qortal Migration Studio (project version ${document.version}, supported ${PROJECT_VERSION}).`,
      { details: { file, version: document.version, supported: PROJECT_VERSION } }
    );
  }
  return document;
}

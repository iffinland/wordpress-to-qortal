import { QmsError, ERROR_CODES } from '../errors.js';

export const STATE_SNAPSHOT_SCHEMA = 'qms-state-snapshot@1';
export const STATE_SCHEMA = 'qms-state@1';
export const JOURNAL_SCHEMA = 'qms-journal@1';
export const PROJECT_SCHEMA = 'qms-project@1';

/** Current persistent store version. Forward-only migrations below. */
export const CURRENT_STORE_VERSION = 3;

export const PROJECT_VERSION = 1;

export const EMPTY_MEDIA_STATE = Object.freeze({
  assets: {},
  downloads: {},
  itemRefs: {},
  counters: { bytes: 0, files: 0 }
});

export function createInitialState({ projectId, createdAt, siteIdentity = null, target = null }) {
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
    meta: {},
    identity: siteIdentity
      ? {
          schema: 'qms-identity-state@1',
          siteId: siteIdentity.siteId,
          namespace: siteIdentity.namespace,
          target: target ?? { qdnName: null, resourcePrefix: 'qms' },
          revision: 1,
          mappings: {},
          triples: {},
          conflicts: {},
          history: []
        }
      : null,
    plans: {},
    media: {
      assets: {},
      downloads: {},
      itemRefs: {},
      counters: { bytes: 0, files: 0 }
    },
    publication: {
      schema: 'qms-publication-state@1',
      revision: 1,
      plans: {},
      handoffs: {},
      resources: {},
      history: [],
      counters: { batch: 0, handoff: 0 }
    }
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
  state.plans = state.plans && typeof state.plans === 'object' ? state.plans : {};
  state.publication = state.publication && typeof state.publication === 'object' ? state.publication : {
    schema: 'qms-publication-state@1',
    revision: 1,
    plans: {},
    handoffs: {},
    resources: {},
    history: [],
    counters: { batch: 0, handoff: 0 }
  };
  state.media = state.media && typeof state.media === 'object' ? state.media : {
    assets: {},
    downloads: {},
    itemRefs: {},
    counters: { bytes: 0, files: 0 }
  };
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
  },
  /**
   * Phase 3 adds persistent identity mappings, compact plan records, media
   * receipts and reference counts. Item bodies never live in this store.
   */
  1(state) {
    const migrated = baseEventLogNormalization(state);
    migrated.identity = state.identity ?? null;
    migrated.plans = state.plans ?? {};
    const media = state.media ?? {};
    migrated.media = {
      assets: media.assets ?? {},
      downloads: media.downloads ?? {},
      itemRefs: media.itemRefs ?? {},
      counters: {
        bytes: Number.isInteger(media.counters?.bytes) ? media.counters.bytes : 0,
        files: Number.isInteger(media.counters?.files) ? media.counters.files : 0
      }
    };
    return migrated;
  },
  /**
   * Phase 5 adds publication plans, portable handoff records and durable
   * per-resource publication history. Bodies remain in handoff packages and
   * media assets; this state holds metadata and evidence only.
   */
  2(state) {
    const migrated = baseEventLogNormalization(state);
    migrated.publication = state.publication ?? {
      schema: 'qms-publication-state@1',
      revision: 1,
      plans: {},
      handoffs: {},
      resources: {},
      history: [],
      counters: { batch: 0, handoff: 0 }
    };
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
  if (state.identity !== null && state.identity !== undefined) {
    if (
      typeof state.identity !== 'object' ||
      typeof state.identity.siteId !== 'string' ||
      typeof state.identity.namespace !== 'string' ||
      !state.identity.mappings ||
      typeof state.identity.mappings !== 'object'
    ) {
      throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State identity index is invalid.', {
        details: { file }
      });
    }
  }
  if (state.plans !== undefined && (typeof state.plans !== 'object' || Array.isArray(state.plans))) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State plans index is invalid.', {
      details: { file }
    });
  }
  if (state.media !== undefined && (typeof state.media !== 'object' || Array.isArray(state.media))) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State media index is invalid.', {
      details: { file }
    });
  }
  if (state.publication !== undefined) {
    if (
      typeof state.publication !== 'object' ||
      Array.isArray(state.publication) ||
      state.publication.schema !== 'qms-publication-state@1' ||
      typeof state.publication.handoffs !== 'object' ||
      Array.isArray(state.publication.handoffs) ||
      !Array.isArray(state.publication.history)
    ) {
      throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, 'State publication index is invalid.', {
        details: { file }
      });
    }
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

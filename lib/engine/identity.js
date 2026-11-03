import { createHash, randomBytes } from 'node:crypto';
import { QmsError, ERROR_CODES } from './errors.js';
import { stableStringify, sha256Value } from '../model/content.js';

/**
 * Immutable site identity and project-scoped QDN namespace.
 *
 * A site_id is generated once per project and never derived from a mutable
 * title, slug or URL. The QDN namespace is derived from the site_id with a
 * cryptographic hash, so two projects that share a Qortal name still get
 * disjoint identifier namespaces.
 */
export const SITE_IDENTITY_SCHEMA = 'qms-site-identity@1';
export const IDENTITY_STATE_SCHEMA = 'qms-identity-state@1';
export const DEFAULT_RESOURCE_PREFIX = 'qms';
export const IDENTIFIER_MAX_LENGTH = 64;
export const QORTAL_NAME_MIN_LENGTH = 3;
export const QORTAL_NAME_MAX_LENGTH = 40;
export const SITE_ID_PATTERN = /^site_[a-z0-9]{16,64}$/;
export const QORTAL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{1,38}[A-Za-z0-9])$/;
export const RESOURCE_PREFIX_PATTERN = /^[a-z0-9]{1,8}$/;
export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const PUBLICATION_STATUSES = Object.freeze(['reserved', 'prepared', 'remote_verified', 'published']);
export const LOCAL_PREPARATION_STATES = Object.freeze(['reserved', 'partial', 'prepared']);
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32(buffer, length = 16) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < length) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (output.length >= length) break;
  }
  if (bits > 0 && output.length < length) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output.slice(0, length);
}

function hashBase32(text, length = 16) {
  return base32(createHash('sha256').update(String(text), 'utf8').digest(), length);
}

export function newSiteIdentity({ clock }) {
  const siteId = 'site_' + randomBytes(16).toString('hex');
  return {
    schema: SITE_IDENTITY_SCHEMA,
    siteId,
    namespace: namespaceForSite(siteId),
    createdAt: clock.nowIso()
  };
}

export function assertSiteId(siteId) {
  if (typeof siteId !== 'string' || !SITE_ID_PATTERN.test(siteId)) {
    throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Invalid site identity: ' + String(siteId), {
      details: { siteId }
    });
  }
  return siteId;
}

export function namespaceForSite(siteId) {
  assertSiteId(siteId);
  // 70 bits of a SHA-256 digest, lowercase base32. Stable for the site_id and
  // independent of the project name, WordPress base URL or target Qortal name.
  return 'ns' + hashBase32(siteId, 14);
}

export function validateQortalName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new QmsError(ERROR_CODES.TARGET_NAME_REQUIRED, 'A target Qortal name is required for identity planning.', {
      details: { name: name ?? null }
    });
  }
  const trimmed = name.trim();
  if (
    trimmed.length < QORTAL_NAME_MIN_LENGTH ||
    trimmed.length > QORTAL_NAME_MAX_LENGTH ||
    !QORTAL_NAME_PATTERN.test(trimmed)
  ) {
    throw new QmsError(ERROR_CODES.TARGET_NAME_INVALID, 'Invalid Qortal name: ' + trimmed, {
      details: {
        name: trimmed,
        minLength: QORTAL_NAME_MIN_LENGTH,
        maxLength: QORTAL_NAME_MAX_LENGTH,
        pattern: QORTAL_NAME_PATTERN.source
      }
    });
  }
  return trimmed;
}

export function validateResourcePrefix(value) {
  const prefix = value ?? DEFAULT_RESOURCE_PREFIX;
  if (typeof prefix !== 'string' || !RESOURCE_PREFIX_PATTERN.test(prefix)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'Invalid resource prefix: ' + String(prefix), {
      details: { prefix, pattern: RESOURCE_PREFIX_PATTERN.source }
    });
  }
  return prefix;
}

export function projectTarget(project = {}) {
  const settingsPrefix = project.settings?.identity?.resourcePrefix;
  const name = project.target?.qdnName ?? null;
  const prefix = validateResourcePrefix(settingsPrefix ?? DEFAULT_RESOURCE_PREFIX);
  return {
    qdnName: name === null || name === undefined || String(name).trim() === '' ? null : validateQortalName(String(name)),
    resourcePrefix: prefix
  };
}

export function assertTargetForPlanning(target) {
  if (!target?.qdnName) {
    throw new QmsError(
      ERROR_CODES.TARGET_NAME_REQUIRED,
      'Configure target.qdnName before planning a migration batch.',
      { details: { target } }
    );
  }
  return { qdnName: validateQortalName(target.qdnName), resourcePrefix: validateResourcePrefix(target.resourcePrefix) };
}

/**
 * Validate a user-supplied target without writing it. Phase 4 uses this from
 * the desktop wizard; it performs only local validation and never contacts a
 * node or claims remote name ownership.
 */
export function validateTargetInput(input = {}) {
  return {
    qdnName: validateQortalName(input.qdnName),
    resourcePrefix: validateResourcePrefix(input.resourcePrefix)
  };
}

/**
 * Publication state is deliberately separate from identity reservation.
 * reserved means planned/prepared locally and never published. Legacy
 * mappings used status:published; they remain readable, but no Phase 4 code
 * path sets them.
 */
export function publicationStatusFor(mapping) {
  if (!mapping) return null;
  if (PUBLICATION_STATUSES.includes(mapping.publicationStatus)) {
    return mapping.publicationStatus;
  }
  if (mapping.status === 'published') {
    return 'published';
  }
  if (mapping.status === 'skipped') {
    return 'skipped';
  }
  return 'reserved';
}

export function publicationIsVerified(mapping) {
  const status = publicationStatusFor(mapping);
  return status === 'remote_verified' || status === 'published';
}

export function preparationStatusFor(mapping) {
  if (!mapping) return null;
  if (LOCAL_PREPARATION_STATES.includes(mapping.localPreparation)) {
    return mapping.localPreparation;
  }
  return 'reserved';
}

/**
 * A mapping is pending publication when its identity exists locally but the
 * resource has not been verified on QDN. Identical hashes alone never prove
 * publication.
 */
export function isPendingPublication(mapping) {
  const status = publicationStatusFor(mapping);
  return status === 'reserved' || status === 'prepared';
}

function kindForContentType(contentType, mimeType) {
  if (contentType === 'media') {
    const mime = String(mimeType ?? '').toLowerCase();
    if (mime.startsWith('image/')) return 'img';
    if (mime.startsWith('audio/')) return 'aud';
    if (mime.startsWith('video/')) return 'vid';
    return 'doc';
  }
  if (contentType === 'category' || contentType === 'tag') return 'term';
  if (contentType === 'index') return 'idx';
  if (contentType === 'manifest') return 'man';
  return 'con';
}

export function serviceForContentType(contentType, mimeType) {
  if (contentType === 'media') {
    const mime = String(mimeType ?? '').toLowerCase();
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('video/')) return 'VIDEO';
    return 'FILE';
  }
  return 'DOCUMENT';
}

/**
 * Derive the complete QDN identity (service, name, identifier) for one source
 * item. The identifier depends only on the immutable site identity, the source
 * key and the configured prefix — never on title, slug or URL.
 */
export function deriveQdnIdentity({ siteId, namespace, sourceKey, contentType, mimeType = null, target }) {
  const siteNamespace = namespace ?? namespaceForSite(siteId);
  const prefix = validateResourcePrefix(target?.resourcePrefix);
  const kind = kindForContentType(contentType, mimeType);
  const stable = hashBase32(String(sourceKey), 16);
  const identifier = (prefix + '-' + siteNamespace + '-' + kind + stable).slice(0, IDENTIFIER_MAX_LENGTH);
  assertQdnIdentifier(identifier);
  return {
    service: serviceForContentType(contentType, mimeType),
    name: target?.qdnName ?? null,
    identifier
  };
}

export function assertQdnIdentifier(identifier) {
  if (
    typeof identifier !== 'string' ||
    identifier.length === 0 ||
    identifier.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(identifier)
  ) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'Invalid QDN identifier: ' + String(identifier), {
      details: { identifier, maxLength: IDENTIFIER_MAX_LENGTH, pattern: IDENTIFIER_PATTERN.source }
    });
  }
  return identifier;
}

export function tripleKey(triple) {
  if (!triple || !triple.service || !triple.name || !triple.identifier) {
    throw new QmsError(ERROR_CODES.IDENTITY_MAPPING_CONFLICT, 'A QDN mapping requires service, name and identifier.', {
      details: { triple }
    });
  }
  return triple.service + '|' + triple.name + '|' + triple.identifier;
}

export function routeHashFor(document) {
  return sha256Value({
    content_type: document.content_type ?? null,
    slug: document.identity?.slug ?? null,
    old_url: document.identity?.old_url ?? null,
    canonical_url: document.identity?.canonical_url ?? null,
    parent_key: document.identity?.parent_key ?? null,
    menu_order: document.identity?.menu_order ?? null
  });
}

export function routeProjectionFromIndex(entry) {
  return sha256Value({
    content_type: entry.contentType ?? null,
    slug: entry.slug ?? null,
    old_url: entry.oldUrl ?? null
  });
}

export function newIdentityState({ siteIdentity, target }) {
  return {
    schema: IDENTITY_STATE_SCHEMA,
    siteId: siteIdentity.siteId,
    namespace: siteIdentity.namespace,
    target: { ...target },
    revision: 1,
    mappings: {},
    triples: {},
    conflicts: {},
    history: []
  };
}

export function conflictIdFor(kind, sourceKey, triple) {
  return 'cnf_' + hashBase32(kind + '|' + sourceKey + '|' + tripleKey(triple), 20);
}

/**
 * Classify one candidate against the persisted mapping. Pure: no writes.
 * Returns new|modified|unchanged|route_changed|conflict.
 */
export function classifyCandidate({ entry, mapping, identity, target }) {
  const derived = deriveQdnIdentity({
    siteId: identity.siteId,
    namespace: identity.namespace,
    sourceKey: entry.sourceKey,
    contentType: entry.contentType,
    mimeType: entry.mimeType ?? null,
    target
  });
  if (!mapping) {
    const owner = identity.triples[tripleKey(derived)];
    if (owner && owner !== entry.sourceKey) {
      return {
        status: 'conflict',
        conflict: {
          kind: 'IDENTITY_COLLISION',
          sourceKey: entry.sourceKey,
          triple: derived,
          existingSourceKey: owner,
          message: 'The derived QDN triple is already mapped to another source item.'
        },
        triple: derived
      };
    }
    return { status: 'new', triple: derived };
  }
  if (mapping.status === 'migrated' || mapping.status === 'skipped') {
    return {
      status: 'conflict',
      conflict: {
        kind: 'IDENTITY_MAPPING_CONFLICT',
        sourceKey: entry.sourceKey,
        triple: { service: mapping.service, name: mapping.name, identifier: mapping.identifier },
        message: 'The mapping is not in an active state.',
        mappingStatus: mapping.status
      },
      triple: { service: mapping.service, name: mapping.name, identifier: mapping.identifier }
    };
  }
  const persistedTriple = { service: mapping.service, name: mapping.name, identifier: mapping.identifier };
  if (tripleKey(persistedTriple) !== tripleKey(derived)) {
    return {
      status: 'conflict',
      conflict: {
        kind: 'IDENTITY_MIGRATION_REQUIRED',
        sourceKey: entry.sourceKey,
        triple: persistedTriple,
        derivedTriple: derived,
        message: 'The target name or namespace configuration changed; an explicit identity migration is required.'
      },
      triple: persistedTriple
    };
  }
  const routeHash = entry.routeHash ?? routeProjectionFromIndex(entry);
  if (mapping.contentHash !== entry.contentHash) {
    return { status: 'modified', triple: derived, contentChanged: true, routeChanged: mapping.routeHash !== routeHash };
  }
  if (mapping.routeHash !== routeHash || mapping.slug !== (entry.slug ?? null)) {
    return { status: 'route_changed', triple: derived, contentChanged: false, routeChanged: true };
  }
  const publicationStatus = publicationStatusFor(mapping);
  const localPreparation = preparationStatusFor(mapping);
  if (publicationIsVerified(mapping)) {
    return {
      status: 'unchanged',
      triple: derived,
      contentChanged: false,
      routeChanged: false,
      publicationStatus,
      localPreparation,
      pendingPublication: false
    };
  }
  // Same content hash and route, but the resource was only reserved or
  // prepared locally. Classifying this as unchanged silently hid unpublished
  // work and made a repeated plan look complete.
  return {
    status: 'reserved',
    triple: derived,
    contentChanged: false,
    routeChanged: false,
    publicationStatus,
    localPreparation,
    pendingPublication: true
  };
}

export function addConflictRecord(identity, { planId, conflict, now }) {
  const id = conflictIdFor(conflict.kind, conflict.sourceKey, conflict.triple);
  if (!identity.conflicts[id]) {
    identity.conflicts[id] = {
      id,
      kind: conflict.kind,
      sourceKey: conflict.sourceKey,
      planId: planId ?? null,
      createdAt: now,
      resolvedAt: null,
      resolution: null,
      details: conflict
    };
  }
  return identity.conflicts[id];
}

export function reserveMapping(identity, {
  entry,
  triple,
  planId,
  routeHash,
  now,
  alternate = 0,
  pendingRouteUpdate = false
}) {
  const key = tripleKey(triple);
  const owner = identity.triples[key];
  if (owner && owner !== entry.sourceKey) {
    throw new QmsError(ERROR_CODES.IDENTITY_COLLISION, 'Refusing to overwrite a QDN triple owned by another source item.', {
      details: { triple, owner, sourceKey: entry.sourceKey }
    });
  }
  const existing = identity.mappings[entry.sourceKey];
  const previousTriple = existing
    ? { service: existing.service, name: existing.name, identifier: existing.identifier }
    : null;
  if (previousTriple && tripleKey(previousTriple) !== key) {
    throw new QmsError(
      ERROR_CODES.IDENTITY_MIGRATION_REQUIRED,
      'Refusing to reassign an existing source identity without an explicit migration.',
      { details: { sourceKey: entry.sourceKey, previousTriple, nextTriple: triple } }
    );
  }
  identity.mappings[entry.sourceKey] = {
    schema: 'qms-qdn-mapping@1',
    sourceKey: entry.sourceKey,
    contentType: entry.contentType,
    sourceType: entry.sourceType ?? null,
    service: triple.service,
    name: triple.name,
    identifier: triple.identifier,
    contentHash: entry.contentHash,
    routeHash,
    slug: entry.slug ?? null,
    status: 'reserved',
    publicationStatus: existing?.publicationStatus ?? 'reserved',
    localPreparation: existing && existing.contentHash === entry.contentHash
      ? preparationStatusFor(existing)
      : 'reserved',
    preparedAt: existing && existing.contentHash === entry.contentHash ? (existing.preparedAt ?? null) : null,
    publishedAt: existing?.publishedAt ?? null,
    remoteVerifiedAt: existing?.remoteVerifiedAt ?? null,
    alternate,
    planId: planId ?? null,
    firstMappedAt: existing?.firstMappedAt ?? now,
    updatedAt: now,
    revision: identity.revision,
    pendingRouteUpdate: pendingRouteUpdate === true
  };
  identity.triples[key] = entry.sourceKey;
  identity.revision += 1;
  return identity.mappings[entry.sourceKey];
}

function nextAlternateTriple(identity, base, sourceKey, contentType, target, mimeType) {
  for (let counter = 1; counter < 1000; counter += 1) {
    const suffix = '-a' + counter;
    const identifier = (base.identifier.slice(0, IDENTIFIER_MAX_LENGTH - suffix.length) + suffix);
    const triple = { service: base.service, name: base.name, identifier };
    if (!identity.triples[tripleKey(triple)] || identity.triples[tripleKey(triple)] === sourceKey) {
      return { triple, counter };
    }
  }
  throw new QmsError(ERROR_CODES.IDENTITY_COLLISION, 'Could not derive a free alternate QDN identifier.', {
    details: { sourceKey, contentType, target, mimeType }
  });
}

/**
 * Apply plan reservations to an in-memory draft identity. The planner keeps
 * this in the same transaction as the compact plan record so a crash cannot
 * reserve identities without leaving an inspectable plan behind.
 */
export function reservePlanInState(identity, { entries, planId, now }) {
  if (!identity) {
    throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Identity state is not initialized.');
  }
  const target = assertTargetForPlanning(identity.target);
  const reserved = [];
  const conflicts = [];
  for (const entry of entries) {
    const mapping = identity.mappings[entry.sourceKey] ?? null;
    const classification = classifyCandidate({ entry, mapping, identity, target });
    if (classification.status === 'conflict') {
      conflicts.push(addConflictRecord(identity, {
        planId,
        conflict: classification.conflict,
        now
      }));
      continue;
    }
    if (!['new', 'modified', 'route_changed', 'reserved'].includes(classification.status)) {
      continue;
    }
    const routeHash = entry.routeHash ?? routeProjectionFromIndex(entry);
    reserved.push(reserveMapping(identity, {
      entry,
      triple: classification.triple,
      planId,
      routeHash,
      now,
      pendingRouteUpdate: classification.status === 'route_changed'
    }));
  }
  return { reserved, conflicts };
}

export class IdentityService {
  constructor({ store, project, clock, persistProjectTarget }) {
    this.store = store;
    this.getProject = typeof project === 'function' ? project : () => project;
    this.clock = clock;
    this.persistProjectTarget = persistProjectTarget ?? null;
  }

  get state() {
    return this.store.state.identity;
  }

  async ensureInitialized() {
    const project = this.getProject();
    const site = project.identity;
    if (!site?.siteId) {
      throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Project has no persistent site identity.', {
        details: { projectId: project.id }
      });
    }
    assertSiteId(site.siteId);
    if (!this.state) {
      const initial = newIdentityState({ siteIdentity: site, target: projectTarget(project) });
      await this.store.transaction((draft) => {
        draft.identity = initial;
      });
      return { initialized: true, siteId: site.siteId };
    }
    if (this.state.siteId !== site.siteId) {
      throw new QmsError(ERROR_CODES.IDENTITY_MISMATCH, 'Project site identity does not match persisted identity state.', {
        details: { projectSiteId: site.siteId, stateSiteId: this.state.siteId }
      });
    }
    const mirror = projectTarget(project);
    if (
      Object.keys(this.state.mappings ?? {}).length === 0 &&
      (mirror.qdnName !== this.state.target.qdnName || mirror.resourcePrefix !== this.state.target.resourcePrefix)
    ) {
      await this.store.transaction((draft) => {
        draft.identity.target = mirror;
        draft.identity.revision += 1;
      });
    }
    return { initialized: false, siteId: site.siteId };
  }

  target() {
    return { ...this.state.target };
  }

  requireTarget() {
    return assertTargetForPlanning(this.target());
  }

  describe() {
    const mappings = Object.values(this.state.mappings ?? {});
    const conflicts = Object.values(this.state.conflicts ?? {});
    const pendingPublication = mappings.filter((mapping) => isPendingPublication(mapping));
    return {
      schema: IDENTITY_STATE_SCHEMA,
      siteId: this.state.siteId,
      namespace: this.state.namespace,
      target: { ...this.state.target },
      revision: this.state.revision,
      mappingCount: mappings.length,
      activeMappingCount: mappings.filter((mapping) => mapping.status === 'reserved' || mapping.status === 'published').length,
      reservedCount: mappings.filter((mapping) => publicationStatusFor(mapping) === 'reserved').length,
      preparedCount: mappings.filter((mapping) => preparationStatusFor(mapping) === 'prepared').length,
      pendingPublicationCount: pendingPublication.length,
      remotelyVerifiedCount: mappings.filter((mapping) => publicationStatusFor(mapping) === 'remote_verified').length,
      publishedCount: mappings.filter((mapping) => publicationStatusFor(mapping) === 'published').length,
      conflictCount: conflicts.filter((conflict) => !conflict.resolvedAt).length,
      conflictTotal: conflicts.length,
      historyCount: this.state.history.length
    };
  }

  mappingFor(sourceKey) {
    return this.state.mappings[sourceKey] ?? null;
  }

  listMappings({ status = null, limit = 1000 } = {}) {
    return Object.values(this.state.mappings)
      .filter((mapping) => !status || mapping.status === status)
      .slice(0, limit);
  }

  listConflicts({ includeResolved = false, limit = 1000 } = {}) {
    return Object.values(this.state.conflicts)
      .filter((conflict) => includeResolved || !conflict.resolvedAt)
      .slice(0, limit);
  }

  async reservePlan({ entries, planId }) {
    this.requireTarget();
    const now = this.clock.nowIso();
    let reserved = [];
    let conflicts = [];
    await this.store.transaction((draft) => {
      const result = reservePlanInState(draft.identity, { entries, planId, now });
      reserved = result.reserved;
      conflicts = result.conflicts;
    });
    return { reserved, conflicts };
  }

  async resolveConflict({ conflictId: id, resolution }) {
    if (!['skip', 'alternate', 'abort'].includes(resolution)) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, "resolution must be 'skip', 'alternate' or 'abort'.", {
        details: { resolution }
      });
    }
    const now = this.clock.nowIso();
    let result = null;
    await this.store.transaction((draft) => {
      const conflict = draft.identity.conflicts[id];
      if (!conflict) {
        throw new QmsError(ERROR_CODES.CONFLICT_NOT_FOUND, 'Unknown identity conflict: ' + String(id), {
          details: { conflictId: id }
        });
      }
      if (conflict.resolvedAt) {
        result = conflict;
        return;
      }
      if (resolution === 'alternate') {
        const details = conflict.details ?? {};
        const base = details.derivedTriple ?? details.triple;
        if (!base) {
          throw new QmsError(ERROR_CODES.IDENTITY_MAPPING_CONFLICT, 'Conflict has no triple to alternate.', {
            details: { conflictId: id }
          });
        }
        const entry = {
          sourceKey: conflict.sourceKey,
          contentType: details.contentType ?? details.triple?.contentType ?? 'media',
          sourceType: details.sourceType ?? null,
          contentHash: details.contentHash ?? null,
          slug: details.slug ?? null
        };
        const alternate = nextAlternateTriple(draft.identity, base, entry.sourceKey, entry.contentType, draft.identity.target, details.mimeType);
        const mapping = reserveMapping(draft.identity, {
          entry,
          triple: alternate.triple,
          planId: conflict.planId,
          routeHash: details.routeHash ?? sha256Value({ sourceKey: entry.sourceKey }),
          now,
          alternate: alternate.counter
        });
        result = { conflictId: id, resolution, mapping };
      } else {
        result = { conflictId: id, resolution };
      }
      conflict.resolvedAt = now;
      conflict.resolution = resolution;
    });
    return result;
  }

  async migrationPreview({ target }) {
    const current = this.target();
    const next = {
      qdnName: validateQortalName(target?.qdnName ?? current.qdnName),
      resourcePrefix: validateResourcePrefix(target?.resourcePrefix ?? current.resourcePrefix)
    };
    if (next.qdnName === current.qdnName && next.resourcePrefix === current.resourcePrefix) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'The requested target is identical to the current identity target.');
    }
    const mappingCount = Object.keys(this.state.mappings).length;
    const token = 'mig_' + hashBase32(stableStringify({
      siteId: this.state.siteId,
      from: current,
      to: next,
      revision: this.state.revision,
      mappingCount
    }), 32);
    const preview = {
      token,
      from: current,
      to: next,
      mappingCount,
      revision: this.state.revision,
      createdAt: this.clock.nowIso()
    };
    await this.store.transaction((draft) => {
      draft.identity.pendingMigration = preview;
    });
    return preview;
  }

  async applyMigration({ token }) {
    if (typeof token !== 'string' || token === '') {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'A migration token from identity.migrationPreview is required.');
    }
    const pending = this.state.pendingMigration;
    if (!pending || pending.token !== token) {
      throw new QmsError(ERROR_CODES.IDENTITY_MIGRATION_REQUIRED, 'Migration token is stale or invalid; run migration preview again.', {
        details: { provided: token }
      });
    }
    if (pending.revision !== this.state.revision || pending.mappingCount !== Object.keys(this.state.mappings).length) {
      throw new QmsError(ERROR_CODES.IDENTITY_MIGRATION_REQUIRED, 'The identity mapping changed after the migration preview; run it again.', {
        details: { previewRevision: pending.revision, currentRevision: this.state.revision }
      });
    }
    const preview = pending;
    const now = this.clock.nowIso();
    let summary = null;
    await this.store.transaction((draft) => {
      const identity = draft.identity;
      const triples = {};
      let renamedIdentifiers = 0;
      for (const mapping of Object.values(identity.mappings)) {
        const derived = deriveQdnIdentity({
          siteId: identity.siteId,
          namespace: identity.namespace,
          sourceKey: mapping.sourceKey,
          contentType: mapping.contentType,
          mimeType: mapping.mimeType ?? null,
          target: preview.to
        });
        if (derived.identifier !== mapping.identifier) renamedIdentifiers += 1;
        mapping.service = derived.service;
        mapping.name = derived.name;
        mapping.identifier = derived.identifier;
        mapping.updatedAt = now;
        mapping.revision = identity.revision + 1;
        triples[tripleKey(derived)] = mapping.sourceKey;
      }
      identity.triples = triples;
      identity.target = { ...preview.to };
      delete identity.pendingMigration;
      identity.revision += 1;
      identity.history.push({
        at: now,
        from: preview.from,
        to: preview.to,
        mappingCount: preview.mappingCount,
        renamedIdentifiers,
        token
      });
      if (identity.history.length > 100) {
        identity.history.splice(0, identity.history.length - 100);
      }
      summary = { from: preview.from, to: preview.to, mappingCount: preview.mappingCount, renamedIdentifiers };
    });
    if (this.persistProjectTarget) {
      await this.persistProjectTarget(preview.to);
    }
    return summary;
  }

  /** Called by project.update when no mappings exist yet. */
  async adoptProjectTarget(target) {
    await this.store.transaction((draft) => {
      draft.identity.target = { ...target };
      draft.identity.revision += 1;
    });
  }
}

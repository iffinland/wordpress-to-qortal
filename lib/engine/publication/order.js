import { QmsError, ERROR_CODES } from '../errors.js';
import { KIND_PHASE, MAX_BATCH_RESOURCES } from './handoff.js';

export const PUBLISH_BATCH_LIMIT = MAX_BATCH_RESOURCES;
export const DEFAULT_UNCONFIRMED_LIMIT = 20;

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

/** Stable dependency order: media, content, indexes, manifest. */
export function orderResources(resources) {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const sorted = resources
    .slice()
    .sort((left, right) => {
      const phase = (KIND_PHASE[left.kind] ?? 99) - (KIND_PHASE[right.kind] ?? 99);
      if (phase !== 0) return phase;
      if (left.order !== right.order) return left.order - right.order;
      return String(left.id).localeCompare(String(right.id));
    });
  const seen = new Set();
  const visiting = new Set();
  const visit = (resource) => {
    if (seen.has(resource.id)) return;
    if (visiting.has(resource.id)) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Dependency cycle at ' + resource.id + '.');
    visiting.add(resource.id);
    for (const dependency of resource.dependsOn ?? []) {
      const target = byId.get(dependency);
      if (!target) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Unknown dependency ' + dependency + '.');
      visit(target);
    }
    visiting.delete(resource.id);
    seen.add(resource.id);
  };
  sorted.forEach(visit);
  return sorted;
}

/**
 * Partition into dependency waves. A batch never contains a resource whose
 * dependency is in the same or a later batch. Batch size is capped at 20.
 */
export function planBatches(resources, { maxBatch = PUBLISH_BATCH_LIMIT } = {}) {
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > PUBLISH_BATCH_LIMIT) {
    fail(ERROR_CODES.PUBLICATION_BATCH_TOO_LARGE, 'maxBatch must be an integer between 1 and ' + PUBLISH_BATCH_LIMIT + '.');
  }
  const ordered = orderResources(resources);
  const completed = new Set();
  const batches = [];
  let remaining = ordered.slice();
  while (remaining.length > 0) {
    const batch = [];
    const deferred = [];
    for (const resource of remaining) {
      if (batch.length >= maxBatch) {
        deferred.push(resource);
        continue;
      }
      const dependencies = resource.dependsOn ?? [];
      if (dependencies.every((dependency) => completed.has(dependency))) {
        batch.push(resource);
      } else {
        deferred.push(resource);
      }
    }
    if (batch.length === 0) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Dependency graph cannot be scheduled.');
    }
    for (const resource of batch) completed.add(resource.id);
    batches.push(batch);
    remaining = deferred;
  }
  return batches;
}

export function dependencySatisfied(resource, verifiedIds) {
  return (resource.dependsOn ?? []).every((dependency) => verifiedIds.has(dependency));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function failedListFromResponse(response) {
  const direct = response?.error?.unsuccessfulPublishes ?? response?.unsuccessfulPublishes ?? null;
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') return Object.values(direct);
  return [];
}

function keyOf(resource) {
  return String(resource.service) + '|' + String(resource.name) + '|' + String(resource.identifier);
}

function classifyFailureReason(reason) {
  const text = String(reason ?? '').toLowerCase();
  if (text.includes('declin') || text.includes('denied') || text.includes('rejected') || text.includes('user_declined')) {
    return 'declined';
  }
  if (text.includes('insufficient') || text.includes('balance') || text.includes('fee')) {
    return 'failed';
  }
  if (text.includes('name') && (text.includes('belong') || text.includes('own'))) {
    return 'blocked';
  }
  if (text.includes('timeout') || text.includes('timed out') || text.includes('unknown')) {
    return 'ambiguous';
  }
  return 'failed';
}

/**
 * Normalize the two real Hub response shapes:
 * - an array of successful resource responses;
 * - { error: { unsuccessfulPublishes: [...] } } on partial failure.
 * A thrown request is never treated as a definite failure: resources may have
 * been submitted before the error, so they become ambiguous until verification.
 */
export function normalizePublishOutcome({ resources, response = null, error = null, submittedAt = null }) {
  const results = resources.map((resource) => ({
    resourceId: resource.id,
    service: resource.service,
    name: resource.name,
    identifier: resource.identifier,
    status: 'ambiguous',
    reason: null,
    txSignature: null,
    submittedAt
  }));
  const byKey = new Map(resources.map((resource, index) => [keyOf(resource), index]));
  const byIdentifier = new Map(resources.map((resource, index) => [resource.identifier, index]));

  if (error) {
    const message = error.message ?? String(error);
    const status = classifyFailureReason(message);
    for (const result of results) {
      result.status = status === 'declined' || status === 'blocked' ? status : 'ambiguous';
      result.reason = message;
    }
    return { results, responseShape: 'thrown', partial: true };
  }

  const failed = failedListFromResponse(response);
  const seenFailures = new Set();
  for (const failure of failed) {
    const index = byKey.get(String(failure?.service) + '|' + String(failure?.name) + '|' + String(failure?.identifier))
      ?? byIdentifier.get(failure?.identifier);
    if (index === undefined) continue;
    seenFailures.add(index);
    const status = classifyFailureReason(failure?.reason);
    results[index].status = status;
    results[index].reason = failure?.reason ?? 'Qortal reported an unsuccessful publish.';
  }

  if (Array.isArray(response)) {
    const successful = new Set();
    response.forEach((entry) => {
      const index = byIdentifier.get(entry?.identifier)
        ?? byKey.get(String(entry?.service) + '|' + String(entry?.name) + '|' + String(entry?.identifier));
      if (index !== undefined) successful.add(index);
    });
    results.forEach((result, index) => {
      if (seenFailures.has(index)) return;
      if (successful.size === 0 || successful.has(index)) {
        result.status = 'submitted';
        result.txSignature = response[index]?.signature ?? response[index]?.txSignature ?? null;
      } else {
        result.status = 'ambiguous';
        result.reason = 'Qortal returned a success array that did not identify this resource.';
      }
    });
    return { results, responseShape: 'success-array', partial: false };
  }

  results.forEach((result, index) => {
    if (seenFailures.has(index)) return;
    result.status = 'ambiguous';
    result.reason = 'Qortal returned a partial response without a success entry; verification is required.';
  });
  return { results, responseShape: 'partial-object', partial: failed.length > 0 };
}

export function summarizeResults(results) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return counts;
}

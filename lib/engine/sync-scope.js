/**
 * Scan coverage and withdrawal authority for incremental synchronization.
 *
 * Missing-item withdrawal is a destructive-looking conclusion about the whole
 * site. It may only be inferred when a completed scan is proven to be
 * exhaustive. Any caller-supplied filter, content-type subset, item limit or
 * truncated source batch makes coverage scoped and removes withdrawal rights.
 * The default is fail-closed: an unknown query option is treated as scoping.
 */
export const SYNC_SCOPE_SCHEMA = 'qms-sync-scope@1';
export const SCAN_COVERAGE = Object.freeze({
  FULL_SITE: 'full-site',
  SCOPED: 'scoped'
});

/** Options that only change ordering, never which items are covered. */
const NON_SCOPING_QUERY_KEYS = new Set(['order', 'orderby']);

const KNOWN_FILTER_FIELDS = new Set([
  'search', 'status', 'after', 'before', 'modified_after', 'modified_before',
  'categories', 'tags', 'taxonomy', 'author', 'parent', 'slug', 'include',
  'exclude', 'sticky'
]);

function hasValue(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Describe whether a request can prove whole-site coverage.
 *
 * The query argument must be the caller-supplied query before sync injects its
 * own incremental modified_after watermark window.
 */
export function describeScanCoverage({
  mode = 'auto',
  query = {},
  contentTypes = null,
  maxItems = null,
  capabilityContentTypes = ['post', 'page'],
  truncated = false
} = {}) {
  const reasons = [];
  for (const field of Object.keys(query ?? {}).sort()) {
    if (NON_SCOPING_QUERY_KEYS.has(field)) continue;
    if (!hasValue(query[field])) continue;
    reasons.push({
      code: KNOWN_FILTER_FIELDS.has(field) ? 'QUERY_FILTER' : 'UNKNOWN_QUERY_FILTER',
      field
    });
  }

  const expectedTypes = [...new Set((capabilityContentTypes ?? []).map(String))].sort();
  if (Array.isArray(contentTypes) && contentTypes.length > 0) {
    const requestedTypes = [...new Set(contentTypes.map(String))].sort();
    const missing = expectedTypes.filter((type) => !requestedTypes.includes(type));
    if (missing.length > 0 || requestedTypes.some((type) => !expectedTypes.includes(type))) {
      reasons.push({ code: 'PARTIAL_CONTENT_TYPES', missing });
    }
  }
  if (Number.isInteger(maxItems) && maxItems > 0) {
    reasons.push({ code: 'ITEM_LIMIT', maxItems });
  }
  if (truncated) {
    reasons.push({ code: 'SOURCE_TRUNCATED' });
  }

  const scoped = reasons.length > 0;
  return {
    schema: SYNC_SCOPE_SCHEMA,
    mode,
    coverage: scoped ? SCAN_COVERAGE.SCOPED : SCAN_COVERAGE.FULL_SITE,
    scoped,
    // Only an exhaustive, completed, explicitly full scan may infer absence.
    withdrawalEligible: mode === 'full' && !scoped,
    // A scoped scan must not advance the adapter watermark: doing so would let
    // a future incremental window skip changes outside the scope.
    watermarkEligible: !scoped,
    reasons,
    query: Object.fromEntries(Object.entries(query ?? {}).filter(([, value]) => hasValue(value))),
    contentTypes: Array.isArray(contentTypes) ? [...contentTypes] : null,
    maxItems: Number.isInteger(maxItems) ? maxItems : null
  };
}

/**
 * Combine a persisted scope with the current completeness evidence. Older
 * scans without a scope record are treated as ineligible, never as full-site.
 */
export function scanAllowsAbsenceInference(scan, complete) {
  if (!scan || complete !== true) return false;
  if (scan.mode !== 'full') return false;
  if (scan.withdrawalEligible !== true) return false;
  if (scan.scope?.coverage !== SCAN_COVERAGE.FULL_SITE) return false;
  return true;
}

/** Status-based withdrawals are per-item evidence; absence needs full cover. */
export function requiresFullCoverageForWithdrawal(reason) {
  return String(reason ?? '') === 'MISSING_FROM_COMPLETE_SOURCE_SCAN';
}

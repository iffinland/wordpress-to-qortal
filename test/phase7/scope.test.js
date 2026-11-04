import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScanCoverage,
  scanAllowsAbsenceInference,
  requiresFullCoverageForWithdrawal
} from '../../lib/engine/sync-scope.js';

function scoped(options) {
  const scope = describeScanCoverage({ mode: 'full', ...options });
  assert.equal(scope.coverage, 'scoped', JSON.stringify(scope));
  assert.equal(scope.scoped, true);
  assert.equal(scope.withdrawalEligible, false);
  assert.equal(scope.watermarkEligible, false);
  return scope;
}

test('every supported WordPress filter removes full-site withdrawal authority', () => {
  for (const query of [
    { search: 'contact' },
    { status: 'publish' },
    { after: '2024-01-01T00:00:00Z' },
    { before: '2024-01-01T00:00:00Z' },
    { modified_after: '2024-01-01T00:00:00Z' },
    { modified_before: '2024-01-01T00:00:00Z' },
    { categories: [1] },
    { tags: [2] },
    { taxonomy: 'category' },
    { author: 7 },
    { parent: 0 },
    { slug: 'about' },
    { sticky: true }
  ]) {
    const scope = scoped({ query });
    assert.equal(scope.reasons.some((reason) => reason.code === 'QUERY_FILTER'), true, JSON.stringify(scope));
  }
});

test('unknown query options fail closed and are treated as scoping', () => {
  const scope = scoped({ query: { some_future_filter: 'x' } });
  assert.deepEqual(scope.reasons, [{ code: 'UNKNOWN_QUERY_FILTER', field: 'some_future_filter' }]);
});

test('ordering and empty values do not scope a scan', () => {
  const scope = describeScanCoverage({ mode: 'full', query: { order: 'asc', orderby: 'id', search: '' } });
  assert.equal(scope.coverage, 'full-site');
  assert.equal(scope.withdrawalEligible, true);
  assert.equal(scope.watermarkEligible, true);
  assert.deepEqual(scope.reasons, []);
});

test('content-type subsets, item limits and truncated batches are scoped', () => {
  assert.deepEqual(scoped({ contentTypes: ['post'] }).reasons.map((reason) => reason.code), ['PARTIAL_CONTENT_TYPES']);
  assert.deepEqual(scoped({ maxItems: 10 }).reasons.map((reason) => reason.code), ['ITEM_LIMIT']);
  assert.deepEqual(scoped({ truncated: true }).reasons.map((reason) => reason.code), ['SOURCE_TRUNCATED']);
  // Covering every capability type is not a scope limitation.
  const full = describeScanCoverage({ mode: 'full', contentTypes: ['page', 'post'] });
  assert.equal(full.coverage, 'full-site');
  assert.equal(full.withdrawalEligible, true);
});

test('incremental and auto scans never receive withdrawal authority', () => {
  for (const mode of ['incremental', 'auto']) {
    const scope = describeScanCoverage({ mode });
    assert.equal(scope.withdrawalEligible, false);
  }
});

test('absence inference fails closed for legacy, scoped and incomplete scans', () => {
  assert.equal(scanAllowsAbsenceInference({ mode: 'full' }, true), false);
  assert.equal(scanAllowsAbsenceInference({ mode: 'full', withdrawalEligible: true, scope: { coverage: 'scoped' } }, true), false);
  assert.equal(scanAllowsAbsenceInference({ mode: 'full', withdrawalEligible: false, scope: { coverage: 'full-site' } }, true), false);
  assert.equal(scanAllowsAbsenceInference({ mode: 'full', withdrawalEligible: true, scope: { coverage: 'full-site' } }, false), false);
  assert.equal(scanAllowsAbsenceInference({ mode: 'full', withdrawalEligible: true, scope: { coverage: 'full-site' } }, true), true);
});

test('only the missing-item reason requires full coverage', () => {
  assert.equal(requiresFullCoverageForWithdrawal('MISSING_FROM_COMPLETE_SOURCE_SCAN'), true);
  assert.equal(requiresFullCoverageForWithdrawal('SOURCE_STATUS_DRAFT'), false);
  assert.equal(requiresFullCoverageForWithdrawal(undefined), false);
});

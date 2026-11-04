#!/usr/bin/env node
/**
 * Read-only live re-verification for the Phase 7 remediation.
 *
 * What it proves against a real WordPress site:
 * 1. A rotating Jetpack contact-form JWT (wordpressfoundation.org page 108)
 *    does not change the canonical content hash, but editorial text survives.
 * 2. A scoped full scan (search filter) over a real, fully mapped site infers
 *    no missing-item withdrawals and advances no watermark.
 *
 * It never publishes, signs, deletes or modifies the source. All state stays in
 * a temporary project directory that is removed afterwards. No token value is
 * printed or persisted.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../lib/engine/index.js';
import { normalizePostOrPage } from '../lib/source/wordpress/normalize.js';

const SITE = process.env.QMS_LIVE_SITE ?? 'https://wordpressfoundation.org';
const PAGE_ID = Number(process.env.QMS_LIVE_PAGE ?? 108);
const USER_AGENT = 'QMS-Phase7-ReadOnly-Verification/1.0';
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function fail(message, details = null) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details = null) {
  if (!condition) fail(message, details);
}

async function fetchPage() {
  const url = SITE.replace(/\/+$/, '') + '/wp-json/wp/v2/pages/' + PAGE_ID + '?context=view&_qms=' + Date.now() + Math.random();
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' } });
  if (!response.ok) fail('WordPress page fetch failed', { status: response.status });
  return response.json();
}

function tokenCount(html) {
  return (String(html ?? '').match(JWT_PATTERN) ?? []).length;
}

async function livePageEvidence() {
  const first = await fetchPage();
  const second = await fetchPage();
  const firstDoc = normalizePostOrPage({ contentType: 'page', raw: first, site: SITE });
  const secondDoc = normalizePostOrPage({ contentType: 'page', raw: second, site: SITE });
  const firstTokens = tokenCount(first.content?.rendered ?? '');
  const secondTokens = tokenCount(second.content?.rendered ?? '');
  const firstJwt = (String(first.content?.rendered ?? '').match(JWT_PATTERN) ?? [])[0] ?? null;
  const secondJwt = (String(second.content?.rendered ?? '').match(JWT_PATTERN) ?? [])[0] ?? null;
  const serialized = JSON.stringify(firstDoc);

  assert(firstTokens > 0, 'The live page no longer contains the expected Jetpack JWT; the regression fixture is stale.');
  assert(firstDoc.content_hash === secondDoc.content_hash, 'Rotating Jetpack tokens changed the canonical content hash.');
  assert(!serialized.includes(firstJwt ?? '__none__'), 'A live JWT value reached the normalized document.');
  assert(!/<form/i.test(firstDoc.body.html), 'An unsupported form reached the content-only body.');
  assert(firstDoc.body.text.includes('Please read these questions and answers'), 'Editorial text was lost.');
  assert(firstDoc.warnings.some((warning) => warning.code === 'UNSUPPORTED_INTERACTIVE_CONTENT'), 'No unsupported-feature warning was emitted.');

  return {
    page: first.id,
    slug: first.slug,
    modified_gmt: first.modified_gmt,
    first_request_jwt_present: firstTokens > 0,
    second_request_jwt_present: secondTokens > 0,
    token_rotated: Boolean(firstJwt && secondJwt && firstJwt !== secondJwt),
    content_hash_equal: firstDoc.content_hash === secondDoc.content_hash,
    content_hash: firstDoc.content_hash,
    body_html_length: firstDoc.body.html.length,
    form_removed: !/<form/i.test(firstDoc.body.html),
    editorial_text_preserved: firstDoc.body.text.includes('Please read these questions and answers'),
    media_preserved: firstDoc.media.images.length > 0,
    unsupported_features: [...new Set(firstDoc.unsupported.map((entry) => entry.feature))],
    warnings: firstDoc.warnings.filter((warning) => warning.code === 'UNSUPPORTED_INTERACTIVE_CONTENT').map((warning) => ({
      code: warning.code,
      feature: warning.details.feature,
      provider: warning.details.provider,
      has_token: /eyJ[A-Za-z0-9_-]{10,}\./.test(JSON.stringify(warning))
    }))
  };
}

async function projectEvidence(dataRoot) {
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({
    name: 'Phase 7 live read-only remediation',
    source: { adapter: 'wordpress', baseUrl: SITE },
    target: { qdnName: 'QmsRemediationReadOnly' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0, unknownSizePolicy: 'estimate', unknownSizeBytes: 1024 },
      media: { allowLoopback: false, maxRetries: 0, retryDelayMs: 0 }
    }
  });
  const handle = await engine.projects.open(project.id);
  try {
    const full = await handle.sync.check({ mode: 'full', perPage: 100, autoApplyWithdrawals: false });
    assert(full.status === 'completed', 'The live full scan did not complete.', { status: full.status, error: full.error ?? null });
    assert(full.scope?.coverage === 'full-site', 'A plain full scan was not classified as full-site.', full.scope);
    assert(full.withdrawalEligible === true, 'A plain full scan lost withdrawal eligibility.');
    assert(full.watermarkAdvanced === true, 'A complete full scan did not advance the watermark.');

    const plan = await handle.sync.preparePlan({ scanId: full.scanId, estimateMedia: false, batchSize: 1000 });
    assert(plan.planId, 'Planning did not create mappings for the live full scan.', plan);

    const mappingsBefore = handle.identity.listMappings({ limit: 5000 });
    const activeBefore = mappingsBefore.filter((mapping) => mapping.status !== 'withdrawn').length;
    assert(activeBefore >= 80, 'Fewer live mappings than expected; the safety demonstration would be weak.');

    const scoped = await handle.sync.check({
      mode: 'full',
      query: { search: 'contact' },
      perPage: 100,
      autoApplyWithdrawals: true
    });
    assert(scoped.status === 'completed', 'The live scoped scan did not complete.', scoped);
    assert(scoped.scope?.coverage === 'scoped', 'The scoped live scan was not recognized as scoped.', scoped.scope);
    assert(scoped.withdrawalEligible === false, 'The scoped live scan kept missing-item withdrawal authority.');
    assert(scoped.watermarkAdvanced === false, 'The scoped live scan advanced the watermark.');
    assert(scoped.counts.withdrawn === 0, 'The scoped live scan withdrew items.', scoped.counts);
    assert(scoped.withdrawals.appliedCount === 0, 'The scoped live scan applied withdrawals.', scoped.withdrawals);

    const mappingsAfter = handle.identity.listMappings({ limit: 5000 });
    const activeAfter = mappingsAfter.filter((mapping) => mapping.status !== 'withdrawn').length;
    assert(activeAfter === activeBefore, 'Scoped scan changed active mappings.', { activeBefore, activeAfter });

    return {
      full_scan: {
        scan_id: full.scanId,
        status: full.status,
        complete: full.complete,
        coverage: full.scope.coverage,
        withdrawal_eligible: full.withdrawalEligible,
        watermark_advanced: full.watermarkAdvanced,
        counts: full.counts
      },
      plan: {
        created: Boolean(plan.planId),
        selected: plan.stats?.selected ?? null,
        mappings: activeBefore
      },
      scoped_scan: {
        scan_id: scoped.scanId,
        query: scoped.query,
        status: scoped.status,
        complete: scoped.complete,
        coverage: scoped.scope.coverage,
        withdrawal_eligible: scoped.withdrawalEligible,
        watermark_advanced: scoped.watermarkAdvanced,
        counts: scoped.counts,
        withdrawals: scoped.withdrawals,
        absence_candidates_that_were_not_withdrawn: Math.max(0, activeBefore - scoped.counts.scanned),
        modified_items: (scoped.delta?.modified ?? []).map((entry) => ({
          sourceKey: entry.sourceKey,
          previousHash: entry.previousHash,
          contentHash: entry.contentHash
        })),
        resumed_local_items: (scoped.delta?.unpublished ?? []).map((entry) => entry.sourceKey).slice(0, 20),
        warning_codes: scoped.warnings.map((warning) => warning.code)
      },
      active_mappings_before: activeBefore,
      active_mappings_after: activeAfter,
      network_deleted: false
    };
  } finally {
    await handle.close().catch(() => {});
    await engine.close().catch(() => {});
  }
}

async function main() {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-phase7-live-'));
  try {
    const page = await livePageEvidence();
    const project = await projectEvidence(dataRoot);
    const evidence = {
      schema: 'qms-phase7-live-remediation-evidence@1',
      generated_at: new Date().toISOString(),
      mode: 'read-only',
      site: SITE,
      page,
      project,
      publication: false,
      network_deleted: false
    };
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details ?? null
  }, null, 2));
  process.exitCode = 1;
});

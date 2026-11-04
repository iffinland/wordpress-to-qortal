#!/usr/bin/env node
/**
 * Read-only live re-verification of the unsupported-form remediation.
 *
 * Proves against a real WordPress site:
 * 1. A generic POST donation form (page 30) loses its form, controls, hidden
 *    fields and admin-post.php endpoint before hashing; editorial text, links
 *    and media survive.
 * 2. A Jetpack contact form (page 108) keeps its behaviour: no form, no JWT,
 *    editorial text survives.
 * 3. Canonical hashes are stable across repeated source reads.
 * 4. A scoped scan cannot withdraw mappings or advance the watermark.
 *
 * It never publishes, signs, deletes or modifies the source. All project state
 * lives in a temporary directory removed afterwards. No token value is printed
 * or persisted.
 *
 * Usage: node scripts/verify-phase7-form-fix-live.js [--out <file>]
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../lib/engine/index.js';
import { normalizePostOrPage } from '../lib/source/wordpress/normalize.js';

const SITE = process.env.QMS_LIVE_SITE ?? 'https://wordpressfoundation.org';
const USER_AGENT = 'QMS-Form-Fix-ReadOnly-Verification/1.0';
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const FORM_MARKERS = /<(form|input|select|textarea|button|datalist|output|progress|meter|label)\b/i;
const SUBMISSION_MARKERS = /admin-post\.php|admin-ajax\.php|wp-login\.php|xmlrpc\.php|_wpnonce|_wp_http_referer|type="hidden"/i;

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function fetchItem(type, id) {
  const url = SITE.replace(/\/+$/, '') + '/wp-json/wp/v2/' + type + '/' + id + '?context=view&_qms=' + Date.now() + Math.random();
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error('WordPress ' + type + ' fetch failed: HTTP ' + response.status);
  return response.json();
}

function tokenCount(html) {
  return (String(html ?? '').match(JWT_PATTERN) ?? []).length;
}

async function pageEvidence({ type, id, slug, textChecks, mediaCheck, expectedFeature }) {
  const apiType = type === 'page' ? 'pages' : 'posts';
  const first = await fetchItem(apiType, id);
  const second = await fetchItem(apiType, id);
  assert(Number(first.id) === id, 'Unexpected WordPress id for ' + slug);
  const firstDoc = normalizePostOrPage({ contentType: type, raw: first, site: SITE });
  const secondDoc = normalizePostOrPage({ contentType: type, raw: second, site: SITE });
  const html = firstDoc.body.html;
  const serialized = JSON.stringify(firstDoc);
  const firstJwt = (String(first.content?.rendered ?? '').match(JWT_PATTERN) ?? [])[0] ?? null;
  const secondJwt = (String(second.content?.rendered ?? '').match(JWT_PATTERN) ?? [])[0] ?? null;

  assert(!/<form/i.test(html), 'An unsupported form survived on ' + slug);
  assert(!FORM_MARKERS.test(html), 'A form control survived on ' + slug, { sample: html.slice(0, 200) });
  assert(!SUBMISSION_MARKERS.test(html), 'A submission endpoint or hidden-field marker survived on ' + slug);
  assert(!serialized.includes(firstJwt ?? '__none__'), 'A live JWT value reached the normalized document on ' + slug);
  assert(firstDoc.content_hash === secondDoc.content_hash, 'Repeated source reads changed the canonical hash on ' + slug);
  for (const check of textChecks) {
    assert(firstDoc.body.text.includes(check), 'Editorial text was lost on ' + slug + ': ' + check);
  }
  if (mediaCheck) {
    assert(firstDoc.body.html.includes(mediaCheck), 'Editorial media was lost on ' + slug);
    assert(firstDoc.media.images.some((entry) => entry.url.includes(mediaCheck)), 'Media extraction lost ' + mediaCheck);
  }
  const warning = firstDoc.warnings.find((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT');
  assert(warning, 'No UNSUPPORTED_INTERACTIVE_CONTENT warning on ' + slug);
  if (expectedFeature) assert(warning.details.feature === expectedFeature, 'Unexpected feature on ' + slug, warning.details);

  return {
    type,
    id: first.id,
    slug: first.slug,
    modified_gmt: first.modified_gmt,
    content_hash: firstDoc.content_hash,
    body_hash: firstDoc.body.hash,
    hash_equal_across_reads: firstDoc.content_hash === secondDoc.content_hash,
    body_html_length: html.length,
    form_removed: !/<form/i.test(html),
    form_controls_absent: !FORM_MARKERS.test(html),
    submission_endpoints_absent: !SUBMISSION_MARKERS.test(html),
    invisible_jwt_present_in_first_read: tokenCount(first.content?.rendered ?? '') > 0,
    invisible_jwt_present_in_second_read: tokenCount(second.content?.rendered ?? '') > 0,
    jwt_rotated: Boolean(firstJwt && secondJwt && firstJwt !== secondJwt),
    jwt_absent_from_document: !serialized.includes(firstJwt ?? '__none__'),
    editorial_text_checks: textChecks.map((check) => ({ text: check, preserved: firstDoc.body.text.includes(check) })),
    media_checks: mediaCheck ? { marker: mediaCheck, preserved: firstDoc.body.html.includes(mediaCheck) } : null,
    warning: { feature: warning.details.feature, provider: warning.details.provider },
    images: firstDoc.media.images.length,
    links: { internal: firstDoc.links.internal.length, external: firstDoc.links.external.length }
  };
}

async function projectEvidence(dataRoot) {
  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({
    name: 'Phase 7 form-fix live read-only verification',
    source: { adapter: 'wordpress', baseUrl: SITE },
    target: { qdnName: 'QmsFormFixReadOnly' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0, unknownSizePolicy: 'estimate', unknownSizeBytes: 1024 },
      media: { allowLoopback: false, maxRetries: 0, retryDelayMs: 0 }
    }
  });
  const handle = await engine.projects.open(project.id);
  try {
    const full = await handle.sync.check({ mode: 'full', perPage: 100, autoApplyWithdrawals: false });
    assert(full.status === 'completed', 'The live full scan did not complete.', { status: full.status });
    assert(full.scope?.coverage === 'full-site', 'A plain full scan was not classified as full-site.', full.scope);
    assert(full.withdrawalEligible === true, 'A plain full scan lost withdrawal eligibility.');
    const plan = await handle.sync.preparePlan({ scanId: full.scanId, estimateMedia: false, batchSize: 1000 });
    assert(plan.planId, 'Planning did not create mappings for the live full scan.', plan);

    const before = handle.identity.listMappings({ limit: 5000 });
    const activeBefore = before.filter((mapping) => mapping.status !== 'withdrawn').length;
    assert(activeBefore >= 80, 'Fewer live mappings than expected.', { activeBefore });

    const scoped = await handle.sync.check({
      mode: 'full',
      query: { search: 'contact' },
      perPage: 100,
      autoApplyWithdrawals: true
    });
    assert(scoped.status === 'completed', 'The live scoped scan did not complete.', scoped);
    assert(scoped.scope?.coverage === 'scoped', 'The scoped scan was not classified as scoped.');
    assert(scoped.withdrawalEligible === false, 'The scoped scan kept missing-item withdrawal authority.');
    assert(scoped.watermarkAdvanced === false, 'The scoped scan advanced the watermark.');
    assert(scoped.counts.withdrawn === 0, 'The scoped scan withdrew items.');
    assert(scoped.withdrawals.appliedCount === 0, 'The scoped scan applied withdrawals.');

    const after = handle.identity.listMappings({ limit: 5000 });
    const activeAfter = after.filter((mapping) => mapping.status !== 'withdrawn').length;
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
      plan: { created: Boolean(plan.planId), mappings: activeBefore },
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
        absence_candidates_not_withdrawn: Math.max(0, activeBefore - scoped.counts.scanned)
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
  const outIndex = process.argv.indexOf('--out');
  const outFile = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-form-fix-live-'));
  try {
    const page30 = await pageEvidence({
      type: 'page',
      id: 30,
      slug: 'donate',
      textChecks: [
        'Join our group of amazing donors in supporting educational programs',
        'The WordPress Foundation is a 501(c)3 non-profit organization'
      ],
      mediaCheck: 'Lagos.jpg',
      expectedFeature: 'form'
    });
    const page108 = await pageEvidence({
      type: 'page',
      id: 108,
      slug: 'contact',
      textChecks: ['Please read these questions and answers'],
      mediaCheck: null,
      expectedFeature: 'contact_form'
    });
    const project = await projectEvidence(dataRoot);
    const evidence = {
      schema: 'qms-phase7-form-fix-live-evidence@1',
      generated_at: new Date().toISOString(),
      mode: 'read-only',
      site: SITE,
      pages: [page30, page108],
      project,
      publication: false,
      transaction_signed: false,
      network_deleted: false
    };
    const text = JSON.stringify(evidence, null, 2) + '\n';
    if (outFile) await writeFile(outFile, text, 'utf8');
    else process.stdout.write(text);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message, details: error.details ?? null }));
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Blocking release gate for the packaged bounded-scan acceptance suite (BUG-003).
 *
 * A release must not ship while a three-post Quick scan can silently become a
 * full inventory, so release preparation refuses to continue unless the packaged
 * Electron run recorded a pass for all three scenarios.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const file = process.argv.find((value) => value.startsWith('--evidence='))?.slice('--evidence='.length)
  ?? path.join(process.cwd(), 'release', 'packaged-bounded-scan-e2e.json');

const REQUIRED_STAGES = ['boundedScan', 'pause', 'resume'];

function fail(message) {
  console.error('PACKAGED_SCAN_GATE_FAILED: ' + message);
  process.exit(1);
}

let evidence;
try {
  evidence = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  fail('no packaged bounded-scan evidence at ' + file + ' (' + error.message + '). Run: npm run release:packaged-bounded-scan');
}

if (evidence.schema !== 'qms-packaged-bounded-scan-e2e@1') fail('unexpected evidence schema: ' + evidence.schema);
if (evidence.status !== 'pass') fail('the packaged acceptance run did not pass: ' + String(evidence.error ?? 'unknown'));

const stages = evidence.stages ?? {};
for (const stage of REQUIRED_STAGES) {
  if (!stages[stage]) fail('missing stage evidence: ' + stage);
}
const counts = stages.boundedScan?.counts ?? {};
if (Number(counts.posts) !== 1) fail('bounded quick scan must fetch exactly one content page, saw ' + counts.posts);
if (Number(counts.total) > 12) fail('bounded quick scan exceeded its request budget: ' + counts.total);
if (stages.pause?.paused !== true) fail('pause scenario did not record a paused operation');
if (stages.resume?.refetched === true) fail('resume re-fetched a completed content page');

console.log(JSON.stringify({
  schema: 'qms-packaged-scan-gate@1',
  ok: true,
  evidence: file,
  boundedRequests: counts.total,
  contentPages: counts.posts
}, null, 2));

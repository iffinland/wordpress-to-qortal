#!/usr/bin/env node
/**
 * Blocking release gate for the packaged functional acceptance evidence.
 *
 * A public release must not ship unless the packaged app was driven through the
 * essential migration workflow (A-G) and the handoff/receipt/read-back flow (H).
 * Missing, failed, or incomplete evidence is a hard failure.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function argument(name, fallback = null) {
  const entry = process.argv.find((value) => value.startsWith('--' + name + '='));
  return entry ? entry.slice(('--' + name + '=').length) : fallback;
}

const functionalFile = path.resolve(argument('functional', path.join('release', 'packaged-functional-acceptance.json')));
const handoffFile = path.resolve(argument('handoff', path.join('release', 'packaged-handoff-e2e.json')));
const REQUIRED = ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2', 'G3', 'G4', 'I', 'J'];

function fail(message) {
  console.error('FAIL: ' + message);
  process.exit(1);
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail('cannot read ' + label + ' at ' + file + ' (' + error.message + '). Run the packaged harness first.');
  }
}

const functional = await readJson(functionalFile, 'functional acceptance evidence');
if (functional.schema !== 'qms-packaged-functional-acceptance@1') {
  fail('unexpected functional evidence schema: ' + functional.schema);
}
if (functional.status !== 'pass') {
  fail('functional acceptance status is ' + functional.status + ': ' + JSON.stringify(functional.failures ?? functional.fatal ?? []));
}
for (const control of REQUIRED) {
  const entry = functional.controls?.[control];
  if (!entry) fail('missing control ' + control);
  if (entry.status !== 'PASS') fail('control ' + control + ' is ' + entry.status + ' (' + (entry.error ?? 'no error recorded') + ')');
}

const handoff = await readJson(handoffFile, 'packaged handoff evidence');
if (handoff.schema !== 'qms-packaged-handoff-e2e@1') {
  fail('unexpected handoff evidence schema: ' + handoff.schema);
}
if (handoff.status !== 'pass') {
  fail('packaged handoff status is ' + handoff.status + ': ' + (handoff.error ?? 'unknown'));
}
const receipt = handoff.stages?.receiptVerify;
if (!receipt) fail('handoff evidence has no receipt/read-back stage (H)');
if (!(receipt.resources > 0)) fail('receipt stage did not cover any resources');
if (!(receipt.remoteVerifiedRows >= receipt.resources)) {
  fail('only ' + receipt.remoteVerifiedRows + ' of ' + receipt.resources + ' resources were remote verified');
}
if (receipt.importClaimedVerification !== false) {
  fail('receipt import was treated as verification proof');
}

console.log(JSON.stringify({
  status: 'pass',
  functional: { file: functionalFile, controls: REQUIRED.length },
  handoff: { file: handoffFile, resources: receipt.resources, remoteVerifiedRows: receipt.remoteVerifiedRows }
}, null, 2));

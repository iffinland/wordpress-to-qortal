#!/usr/bin/env node
/**
 * Read-only broker deployment verifier. It proves the Ed25519 agent path and
 * the enabled/disabled state without creating or signing a transaction.
 *
 * Usage:
 *   node broker/scripts/operator-verify.js \
 *     --base-url http://127.0.0.1:3199 \
 *     --key-id agent-main-2026-11 \
 *     --key-file /home/qms-maint/.config/qms-broker/deploy-verify.key
 *
 * Output contains only status codes and broker error codes. It never prints
 * the key, a token, an authorization header or a request signature.
 */
import { readFileSync } from 'node:fs';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { signRequest } from '../src/auth.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('missing value for --' + key);
    args[key] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args['base-url'] ?? 'http://127.0.0.1:3199').replace(/\/+$/, '');
const keyId = args['key-id'];
const keyFile = args['key-file'];
if (!keyId || !keyFile) {
  console.error('usage: operator-verify.js --base-url URL --key-id ID --key-file PEM');
  process.exit(2);
}

const privateKey = createPrivateKey(readFileSync(keyFile));
const result = { baseUrl, health: null, auth: null };

const healthResponse = await fetch(baseUrl + '/v1/health');
result.health = {
  status: healthResponse.status,
  body: await healthResponse.json().catch(() => null)
};

const fakeId = 'pub_' + '0'.repeat(24);
const path = '/v1/publications/' + fakeId;
const headers = signRequest({
  method: 'GET',
  path,
  bodyBytes: Buffer.alloc(0),
  keyId,
  privateKey,
  nonce: randomUUID()
});
const authResponse = await fetch(baseUrl + path, { method: 'GET', headers });
const authBody = await authResponse.json().catch(() => null);
result.auth = {
  status: authResponse.status,
  code: authBody?.error?.code ?? null
};

console.log(JSON.stringify(result, null, 2));

const healthy = result.health.status === 200 && result.health.body?.status === 'ok';
const authenticated = result.auth.status === 400 &&
  ['INVALID_REQUEST', 'PUBLICATION_NOT_FOUND'].includes(result.auth.code);
if (!healthy) {
  console.error('FAIL: broker health is not ok');
  process.exit(1);
}
if (!authenticated) {
  console.error('FAIL: signed request did not authenticate (expected 400 INVALID_REQUEST for a fake id, not 401)');
  process.exit(1);
}
console.log('OK: health and Ed25519 agent authentication verified; no transaction submitted.');

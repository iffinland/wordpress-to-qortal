#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { BrokerClient } from '../src/client.js';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}
const a = args(process.argv.slice(2));
const c = new BrokerClient({
  baseUrl: a['base-url'] ?? 'https://vmi3490660.tailb239e8.ts.net:8443',
  keyId: a['key-id'] ?? 'agent-main-2026-11',
  privateKey: readFileSync(a['key-file'] ?? '/home/iffi/.config/qms-broker/agent.key')
});
const id = a.publication ?? 'pub_602a5fbbbb927367b05343ff';
const result = await c.verifyPublication(id);
const p = result.publication;
const r = p.resources?.[0] ?? {};
const e = r.verification?.evidence ?? {};
console.log(JSON.stringify({
  publicationId: p.publicationId,
  state: p.state,
  code: p.code,
  txRef: r.txRef ?? null,
  identifier: r.identifier ?? null,
  expectedBytes: r.bytes ?? null,
  remoteBytes: e.remoteBytes ?? null,
  expectedSha256: r.sha256 ?? null,
  remoteSha256: e.remoteHash ?? null,
  propertiesSize: e.properties?.size ?? null,
  httpStatus: e.httpStatus ?? null,
  contentType: e.contentType ?? null,
  verification: r.verification ?? null
}, null, 2));

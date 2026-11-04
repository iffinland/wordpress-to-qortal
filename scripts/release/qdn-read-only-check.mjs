#!/usr/bin/env node
/**
 * Read-only QDN exact-readback check for an already published resource.
 *
 * This script never publishes, signs or authenticates. It fetches an existing
 * resource with encoding=base64, decodes it, and compares byte length and
 * SHA-256 with expected values. A pass proves the read-back transport and byte
 * comparison against the live node for that exact resource. It does not prove
 * that a new mixed IMAGE/DOCUMENT Hub publication was accepted.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const nodeUrl = String(args['node-url'] ?? 'http://100.94.134.84:12391').replace(/\/$/, '');
const service = String(args.service ?? 'DOCUMENT');
const name = String(args.name ?? 'developer iffi');
const identifier = String(args.identifier ?? 'qms-dev-live-001');
const expectedSha256 = String(args['expected-sha256'] ?? '4a884888e0d9199078cc59ba4e30b0ac8d5bbbc5c162f07b28c0d30e21fca587').toLowerCase();
const expectedBytes = Number(args['expected-bytes'] ?? 23);
const reportPath = args.report ? path.resolve(args.report) : null;

const encoded = (value) => encodeURIComponent(value);
const resourceUrl = nodeUrl + '/arbitrary/' + encoded(service) + '/' + encoded(name) + '/' + encoded(identifier) + '?encoding=base64';
const propertiesUrl = nodeUrl + '/arbitrary/resource/properties/' + encoded(service) + '/' + encoded(name) + '/' + encoded(identifier);

const startedAt = new Date().toISOString();
let failure = null;
let report;
try {
  const response = await fetch(resourceUrl, { signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? null;
  if (response.status !== 200) throw new Error('QDN read-back HTTP ' + response.status);
  if (!/^text\/plain\b/i.test(contentType ?? '')) throw new Error('QDN read-back is not text/plain: ' + contentType);
  const bytes = Buffer.from(text.trim(), 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const propertiesResponse = await fetch(propertiesUrl, { signal: AbortSignal.timeout(30000) });
  const properties = propertiesResponse.ok ? await propertiesResponse.json() : null;
  if (bytes.length !== expectedBytes) throw new Error('QDN byte length ' + bytes.length + ' != expected ' + expectedBytes);
  if (sha256 !== expectedSha256) throw new Error('QDN SHA-256 ' + sha256 + ' != expected ' + expectedSha256);
  report = {
    schema: 'qms-qdn-read-only-check@1',
    ok: true,
    nodeUrl,
    service,
    name,
    identifier,
    status: response.status,
    contentType,
    bytes: bytes.length,
    sha256,
    expectedBytes,
    expectedSha256,
    properties,
    propertiesNote: 'Qortal Core reports the resource directory size, not the payload size. It is diagnostic only.',
    publicationPerformed: false,
    signingPerformed: false,
    startedAt,
    finishedAt: new Date().toISOString()
  };
} catch (error) {
  failure = { message: error.message };
  report = {
    schema: 'qms-qdn-read-only-check@1',
    ok: false,
    nodeUrl,
    service,
    name,
    identifier,
    failure,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}
if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

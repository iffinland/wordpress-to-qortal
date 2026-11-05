#!/usr/bin/env node
/**
 * Read-only live check for the deployed Generic CMS catalog.
 * Never publishes, signs, authenticates or writes to QDN.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const nodeUrl = String(args['node-url'] ?? 'http://100.116.185.83:12391').replace(/\/$/, '');
const name = String(args.name ?? 'developer iffi');
const expectedOwner = String(args.owner ?? 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E');
const reportPath = args.report ? path.resolve(args.report) : null;
const enc = (value) => encodeURIComponent(value);

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
  return await response.json();
}

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
  return await response.text();
}

async function optionalJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { present: false, status: response.status };
    return { present: true, status: response.status, body: await response.json() };
  } catch (error) {
    return { present: false, error: error.message };
  }
}

const startedAt = new Date().toISOString();
const report = {
  schema: 'qms-cms-live-readonly@1',
  nodeUrl,
  name,
  startedAt,
  publicationPerformed: false,
  signingPerformed: false,
  checks: {},
  ok: false
};

try {
  report.checks.status = await getJson(nodeUrl + '/admin/status');
  const nameRecord = await getJson(nodeUrl + '/names/' + enc(name));
  report.checks.name = nameRecord;
  if (nameRecord.name !== name) throw new Error('Name record name mismatch: ' + nameRecord.name);
  if (nameRecord.owner !== expectedOwner) throw new Error('Name owner mismatch: ' + nameRecord.owner);

  const unitFee = Number(await getText(nodeUrl + '/transactions/unitfee?txType=ARBITRARY&timestamp=' + Date.now()));
  report.checks.unitFee = unitFee;

  const manifest = await getJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/qms-cms-manifest');
  report.checks.manifest = { schema: manifest.schema, version: manifest.version, target: manifest.target, summary: manifest.summary };
  if (!['qms-qdn-manifest@1', 'qms-cms-manifest@1'].includes(manifest.schema)) throw new Error('Unsupported live manifest schema: ' + manifest.schema);

  const postsIdentifier = manifest.entrypoints && manifest.entrypoints.posts;
  if (!postsIdentifier) throw new Error('Live manifest has no posts entrypoint.');
  const posts = await getJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/' + enc(postsIdentifier));
  const entries = Array.isArray(posts.entries) ? posts.entries : [];
  report.checks.posts = { identifier: postsIdentifier, count: entries.length, titles: entries.map((entry) => entry.title) };
  if (entries.length === 0) throw new Error('Live posts index is empty.');

  const first = entries[0];
  const contentIdentifier = first.qdn && first.qdn.identifier;
  if (!contentIdentifier) throw new Error('First live post has no content identifier.');
  const content = await getJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/' + enc(contentIdentifier));
  report.checks.content = {
    identifier: contentIdentifier,
    schema: content.schema,
    title: content.title,
    htmlBytes: String(content.body && content.body.html || '').length,
    mediaRefs: Array.isArray(content.media) ? content.media.length : 0
  };
  if (content.schema !== 'qms-qdn-content@1') throw new Error('Live content schema mismatch: ' + content.schema);

  report.checks.settings = await optionalJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/qms-cms-site-settings');
  report.checks.nativeIndex = await optionalJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/qms-cms-native-index');
  report.checks.galleries = await optionalJson(nodeUrl + '/arbitrary/DOCUMENT/' + enc(name) + '/qms-cms-galleries');
  report.ok = true;
} catch (error) {
  report.error = error.message;
}
report.finishedAt = new Date().toISOString();

if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);


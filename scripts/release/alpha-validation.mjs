#!/usr/bin/env node
/**
 * Public-alpha end-to-end validation against a real, read-only WordPress site.
 *
 * The validator drives the real packaged engine host over stdio JSON-RPC. It
 * never publishes to QDN, never signs a transaction and never asks for
 * credentials. Every QDN resource it creates is a local handoff only.
 *
 * Evidence is written as qms-alpha-validation@1. A local fixture read-back is
 * deliberately not performed in this project: a fixture is not a remote QDN
 * verification and must not be reported as live acceptance.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcConnection } from '../../lib/engine/host/client.js';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = String(args['base-url'] ?? 'https://wordpressfoundation.org').replace(/\/$/, '');
const DATA_ROOT = path.resolve(args['data-root'] ?? path.join('/home/iffi/dev-workspace/tmp', 'qms-alpha-validation-' + Date.now()));
const REPORT = path.resolve(args.report ?? path.join(REPO_ROOT, 'desktop/release/alpha-validation.json'));
const KEEP = args['keep-data'] === true;
const HOST_TIMEOUT_MS = 15 * 60 * 1000;

const steps = [];
const startedAt = new Date().toISOString();
let failure = null;

function record(name, detail, started) {
  const ms = Date.now() - started;
  steps.push({ name, ok: true, ms, detail });
  console.log('ALPHA_STEP_OK ' + name + ' ' + ms + 'ms' + (detail ? ' ' + JSON.stringify(detail).slice(0, 600) : ''));
}

async function step(name, fn) {
  const started = Date.now();
  const result = await fn();
  record(name, result ?? null, started);
  return result;
}

function startHost(dataRoot) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin/qms-host.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, QMS_DATA_ROOT: dataRoot },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const client = new JsonRpcConnection({ input: child.stdout, output: child.stdin, defaultTimeoutMs: HOST_TIMEOUT_MS });
  return {
    child,
    client,
    stderr: () => stderr,
    async stop(signal = 'SIGTERM') {
      try { child.kill(signal); } catch { /* already gone */ }
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      client.close();
    }
  };
}

async function request(host, method, params = {}, timeoutMs = HOST_TIMEOUT_MS) {
  return host.client.request(method, params, { timeoutMs });
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function walkFiles(directory) {
  const out = [];
  async function walk(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) out.push(absolute);
    }
  }
  await walk(directory);
  return out.sort();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const summary = {};
await mkdir(DATA_ROOT, { recursive: true, mode: 0o700 });
let host = startHost(DATA_ROOT);
let projectId = null;
try {
  const info = await step('engine_info', async () => {
    const value = await request(host, 'engine.info');
    if (value.apiVersion !== 'qms-engine@1') throw new Error('Unexpected engine API version: ' + value.apiVersion);
    return { apiVersion: value.apiVersion, version: value.version, adapters: value.adapters.map((entry) => entry.id) };
  });
  summary.engineVersion = info.version;
  summary.baseUrl = BASE_URL;

  const project = await step('project_create', async () => {
    const created = await request(host, 'project.create', {
      name: 'Alpha Public Site Validation',
      source: { adapter: 'wordpress', baseUrl: BASE_URL },
      target: { qdnName: 'QmsAlphaSite' },
      settings: {
        media: { timeoutMs: 45000, maxRetries: 2 },
        planning: { batchSize: 15 },
        disk: {
          reserveBytes: 0,
          maxBytesPerRun: 4 * 1024 * 1024 * 1024,
          safetyFactor: 1,
          unknownSizePolicy: 'estimate',
          unknownSizeBytes: 1048576
        }
      }
    });
    projectId = created.id;
    await request(host, 'project.open', { projectId });
    return { projectId, siteId: created.siteId, qdnName: created.target?.qdnName ?? null };
  });
  summary.projectId = project.projectId;
  summary.siteId = project.siteId;

  const validation = await step('source_validate', async () => {
    const value = await request(host, 'source.validate', {
      projectId,
      adapterId: 'wordpress',
      auth: { mode: 'none' },
      source: { baseUrl: BASE_URL }
    });
    if (value.report?.ok !== true) throw new Error('WordPress source validation failed: ' + JSON.stringify(value.report));
    const counts = value.report.counts ?? {};
    if (!(counts.posts > 0 && counts.pages > 0)) throw new Error('Real site did not report posts and pages: ' + JSON.stringify(counts));
    if (!(counts.categories > 0 && counts.tags > 0)) throw new Error('Real site did not report categories and tags: ' + JSON.stringify(counts));
    return { site: value.report.site?.name ?? null, counts, unsupported: value.report.unsupported?.length ?? 0 };
  });
  summary.sourceCounts = validation.counts;

  // Interrupt a real full discovery, then prove the engine recovers it.
  const interrupted = await step('discovery_interrupted', async () => {
    const pending = request(host, 'source.discover', {
      projectId,
      adapterId: 'wordpress',
      auth: { mode: 'none' },
      source: { baseUrl: BASE_URL },
      contentTypes: ['post', 'page'],
      perPage: 50
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await host.stop('SIGKILL');
    await pending;
    return { killedAfterMs: 4000 };
  });
  summary.interrupted = interrupted;

  host = startHost(DATA_ROOT);
  const recoveryStatus = await step('recovery_status', async () => {
    await request(host, 'project.open', { projectId, recoverStaleLock: true });
    const value = await request(host, 'recovery.status', { projectId });
    if (!(value.recovery?.interruptedRuns >= 1)) throw new Error('Expected an interrupted run: ' + JSON.stringify(value));
    return {
      interruptedRuns: value.recovery.interruptedRuns,
      candidates: value.candidates.map((entry) => ({ runId: entry.runId, kind: entry.kind, resumable: entry.resumable }))
    };
  });

  const resumed = await step('recovery_resume', async () => {
    const candidate = recoveryStatus.candidates.find((entry) => entry.kind === 'source.discover' && entry.resumable);
    if (!candidate) throw new Error('No resumable source.discover run: ' + JSON.stringify(recoveryStatus));
    const value = await request(host, 'recovery.resume', { projectId, runId: candidate.runId }, HOST_TIMEOUT_MS);
    if (value.result?.status !== 'completed') throw new Error('Recovered discovery did not complete: ' + JSON.stringify(value));
    return { runId: candidate.runId, batchId: value.result.batchId ?? null, status: value.result.status };
  });

  const batch = await step('discovery_batch_integrity', async () => {
    const projectRoot = path.join(DATA_ROOT, 'projects', projectId);
    const latest = await readJson(path.join(projectRoot, 'artifacts/source/wordpress/latest.json'));
    const batchDir = path.dirname(path.resolve(projectRoot, 'artifacts/source/wordpress', latest.indexFile));
    const index = await readJson(path.join(batchDir, 'index.json'));
    const report = await readJson(path.join(batchDir, 'report.json'));
    if (index.schema !== 'qms-content-index@1') throw new Error('Wrong index schema: ' + index.schema);
    const entries = index.entries ?? [];
    const byType = {};
    for (const entry of entries) byType[entry.contentType] = (byType[entry.contentType] ?? 0) + 1;
    for (const type of ['post', 'page', 'category', 'tag']) {
      if (!(byType[type] > 0)) throw new Error('Discovery omitted supported content type: ' + type);
    }
    if (report.normalized?.items !== entries.length) throw new Error('Index and report item counts disagree.');

    let scanned = 0;
    let formFree = 0;
    let scriptFree = 0;
    let withMedia = 0;
    let withWarnings = 0;
    for (const entry of entries) {
      const document = await readJson(path.join(batchDir, entry.file));
      if (document.schema !== 'qms-content@1') throw new Error('Wrong content schema for ' + entry.sourceKey);
      const html = document.body?.html ?? '';
      if (html) {
        scanned += 1;
        if (!/<form[\s>]/i.test(html)) formFree += 1;
        if (!/<script[\s>]/i.test(html)) scriptFree += 1;
        const mediaBlock = document.media ?? {};
        const mediaCount = ['images', 'audio', 'video', 'documents', 'attachments']
          .reduce((sum, key) => sum + (Array.isArray(mediaBlock[key]) ? mediaBlock[key].length : 0), 0)
          + (mediaBlock.featured ? 1 : 0);
        if (mediaCount > 0) withMedia += 1;
      }
      if ((document.warnings ?? []).length > 0 || (entry.unsupportedCount ?? 0) > 0) withWarnings += 1;
    }
    return {
      batchDir,
      batchId: report.batchId,
      entries: entries.length,
      byType,
      scannedWithHtml: scanned,
      formFree,
      scriptFree,
      itemsWithMedia: withMedia,
      itemsWithWarnings: withWarnings,
      contentRoot: report.normalized?.contentRoot ?? null
    };
  });
  summary.discovery = batch;

  const plan = await step('plan_create', async () => {
    const value = await request(host, 'plan.create', {
      projectId,
      batchSize: 15,
      estimateMedia: true,
      persist: true,
      disk: {
        reserveBytes: 0,
        maxBytesPerRun: 4 * 1024 * 1024 * 1024,
        safetyFactor: 1,
        unknownSizePolicy: 'estimate',
        unknownSizeBytes: 1048576
      }
    });
    if (value.status !== 'completed') throw new Error('Plan did not complete: ' + JSON.stringify(value));
    const loaded = await request(host, 'plan.get', { projectId, planId: value.planId });
    const entries = (loaded.entries ?? loaded.plan?.entries ?? [])
      .filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status));
    if (!(entries.length > 0 && entries.length <= 15)) throw new Error('Plan batch size is wrong: ' + entries.length);
    const identifiers = new Set();
    for (const entry of entries) {
      if (!entry.qdn?.service || !entry.qdn?.identifier) throw new Error('Plan entry lacks QDN identity: ' + JSON.stringify(entry));
      const key = entry.qdn.service + '/' + entry.qdn.name + '/' + entry.qdn.identifier;
      identifiers.add(key);
    }
    return {
      planId: value.planId,
      status: value.status,
      stats: value.stats ?? null,
      entries: entries.map((entry) => ({
        sourceKey: entry.sourceKey,
        status: entry.status,
        service: entry.qdn?.service ?? null,
        identifier: entry.qdn?.identifier ?? null,
        bytes: entry.bytes ?? null,
        mediaCount: entry.mediaCount ?? entry.media?.length ?? null
      })),
      resourceCount: entries.length,
      uniqueIdentities: identifiers.size
    };
  });
  summary.plan = plan;
  const actionable = plan.entries.filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status)).map((entry) => entry.sourceKey);

  const media = await step('media_download', async () => {
    const value = await request(host, 'media.download', {
      projectId,
      planId: plan.planId,
      concurrency: 2,
      disk: { reserveBytes: 0, maxBytesPerRun: 4 * 1024 * 1024 * 1024, safetyFactor: 1 },
      media: { timeoutMs: 45000, maxRetries: 2 }
    });
    if (value.status !== 'completed') throw new Error('Media download did not complete: ' + value.status);
    const inspection = await request(host, 'media.inspect', { projectId });
    const projectRoot = path.join(DATA_ROOT, 'projects', projectId);
    let verified = 0;
    let bytes = 0;
    for (const asset of inspection.assets) {
      const file = path.join(projectRoot, 'media/assets', asset.relativePath);
      const actual = await sha256File(file);
      const expected = String(asset.hash).replace(/^sha256:/, '');
      if (actual !== expected) throw new Error('Media asset hash mismatch: ' + asset.relativePath);
      const size = (await stat(file)).size;
      if (size !== asset.bytes) throw new Error('Media asset size mismatch: ' + asset.relativePath);
      verified += 1;
      bytes += size;
    }
    return {
      status: value.status,
      downloaded: value.downloaded ?? value.counts?.downloaded ?? null,
      failed: value.failed ?? value.counts?.failed ?? 0,
      assets: inspection.totals.assets,
      verifiedAssets: verified,
      verifiedBytes: bytes,
      itemRefs: inspection.totals.itemRefs,
      deduplicatedAssets: inspection.assets.filter((asset) => asset.refCount > 1).length
    };
  });
  summary.media = media;

  const handoff = await step('publication_handoff', async () => {
    const prepared = await request(host, 'publication.prepare', {
      projectId,
      planId: plan.planId,
      selection: actionable,
      feePerResource: 0,
      feeCurrency: 'QORT'
    });
    if (prepared.status !== 'handoff_ready') throw new Error('Handoff is not ready: ' + JSON.stringify(prepared));
    if (prepared.packageValidated !== true) throw new Error('Handoff package did not validate.');
    const projectRoot = path.join(DATA_ROOT, 'projects', projectId);
    const handoffDir = path.resolve(projectRoot, prepared.handoffPath);
    const manifest = await readJson(path.join(handoffDir, 'handoff.json'));
    if (manifest.schema !== 'qms-publication-handoff@1') throw new Error('Wrong handoff schema: ' + manifest.schema);
    const seen = new Set();
    let hashChecked = 0;
    for (const resource of manifest.resources) {
      if (!resource.service || !resource.name || !resource.identifier) throw new Error('Handoff resource has no stable identity.');
      const key = resource.service + '/' + resource.name + '/' + resource.identifier;
      if (seen.has(key)) throw new Error('Duplicate QDN identity in handoff: ' + key);
      seen.add(key);
      const file = path.join(handoffDir, resource.relativePath);
      const actual = await sha256File(file);
      const expected = String(resource.sha256).replace(/^sha256:/, '');
      if (actual !== expected) throw new Error('Handoff payload hash mismatch: ' + resource.relativePath);
      const size = (await stat(file)).size;
      if (size !== resource.bytes) throw new Error('Handoff payload size mismatch: ' + resource.relativePath);
      hashChecked += 1;
    }
    const files = await walkFiles(handoffDir);
    const detail = await request(host, 'publication.get', { projectId, handoffId: prepared.handoffId, validate: true });
    if (detail.packageValid !== true) throw new Error('Publication.get did not validate the package.');
    return {
      handoffId: prepared.handoffId,
      handoffPath: prepared.handoffPath,
      resources: manifest.resources.length,
      hashChecked,
      files: files.length,
      packageValid: detail.packageValid,
      estimate: prepared.estimate ?? null
    };
  });
  summary.handoff = handoff;

  const stableIdentity = await step('stable_qdn_identity', async () => {
    const second = await request(host, 'publication.prepare', {
      projectId,
      planId: plan.planId,
      selection: actionable,
      feePerResource: 0,
      feeCurrency: 'QORT'
    });
    const projectRoot = path.join(DATA_ROOT, 'projects', projectId);
    const first = await readJson(path.join(projectRoot, summary.handoff.handoffPath, 'handoff.json'));
    const again = await readJson(path.join(projectRoot, second.handoffPath, 'handoff.json'));
    const map = (manifest) => manifest.resources.map((resource) => resource.service + '/' + resource.name + '/' + resource.identifier).sort();
    const left = map(first);
    const right = map(again);
    if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error('QDN identities changed between preparations.');
    return { secondHandoffId: second.handoffId, resources: left.length, identical: true };
  });
  summary.stableIdentity = stableIdentity;

  const sync = await step('incremental_sync', async () => {
    const scan = await request(host, 'sync.check', {
      projectId,
      mode: 'incremental',
      auth: { mode: 'none' },
      source: { baseUrl: BASE_URL },
      contentTypes: ['post', 'page'],
      perPage: 50,
      autoApplyWithdrawals: false
    }, HOST_TIMEOUT_MS);
    if (scan.complete !== true) throw new Error('Incremental scan did not complete: ' + JSON.stringify(scan));
    const status = await request(host, 'sync.status', { projectId });
    const conflicts = await request(host, 'sync.conflicts', { projectId, includeResolved: false });
    const withdrawals = await request(host, 'sync.withdrawals', { projectId });
    const delta = await request(host, 'sync.plan', { projectId, scanId: scan.scanId, estimateMedia: false }).catch((error) => ({ error: error.code, message: error.message }));
    if (conflicts.length !== 0) throw new Error('Unexpected conflicts without a source change: ' + JSON.stringify(conflicts));
    if (withdrawals.length !== 0) throw new Error('Unexpected withdrawals without a source change: ' + JSON.stringify(withdrawals));
    return {
      scanId: scan.scanId,
      complete: scan.complete,
      counts: scan.counts ?? null,
      latestStatus: status.latestScan?.status ?? null,
      conflicts: conflicts.length,
      withdrawals: withdrawals.length,
      deltaPlan: delta.planId ? { planId: delta.planId, status: delta.status, stats: delta.stats ?? null } : delta
    };
  });
  summary.sync = sync;

  const cleanup = await step('cleanup_safety', async () => {
    let preview = null;
    let startError = null;
    try {
      preview = await request(host, 'cleanup.preview', { projectId, handoffIds: [handoff.handoffId], retentionDays: 0 });
    } catch (error) {
      if (error.code !== 'CLEANUP_NOT_ELIGIBLE') throw error;
      startError = { code: error.code, message: error.message };
    }
    if (!startError) {
      try {
        await request(host, 'cleanup.start', { projectId, handoffIds: [handoff.handoffId], retentionDays: 0 });
      } catch (error) {
        startError = { code: error.code ?? null, message: error.message };
      }
    }
    if (!startError) throw new Error('Unverified handoff was accepted for cleanup.');
    return {
      schema: preview?.schema ?? null,
      eligible: preview?.eligible ?? false,
      totals: preview?.totals ?? null,
      startRefused: startError
    };
  });
  summary.cleanup = cleanup;

  const history = await step('history_and_diagnostics', async () => {
    const entries = await request(host, 'history.list', { projectId, limit: 100 });
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('History is empty.');
    const snapshot = await request(host, 'history.export', { projectId, reason: 'alpha-validation' });
    const bundle = await request(host, 'support.bundle', {
      projectId,
      appInfo: { version: summary.engineVersion, channel: 'alpha', validation: 'alpha-e2e' },
      settings: {},
      keyring: { available: false },
      logLines: []
    });
    const bundleText = await readFile(path.resolve(DATA_ROOT, bundle.path), 'utf8');
    if (/Authorization:\s*Bearer\s+\S+/i.test(bundleText)) throw new Error('Support bundle leaked an authorization value.');
    if (bundleText.includes(BASE_URL + '/wp-json')) throw new Error('Support bundle leaked a source content URL.');
    const projectRoot = path.join(DATA_ROOT, 'projects', projectId);
    const snapshotPath = path.resolve(projectRoot, snapshot.path ?? snapshot.relativePath ?? '');
    let snapshotExists = false;
    try { await stat(snapshotPath); snapshotExists = true; } catch { snapshotExists = false; }
    return {
      historyEntries: entries.length,
      snapshotSchema: snapshot.schema ?? null,
      snapshotExists,
      bundleSchema: bundle.schema,
      bundleBytes: bundle.bytes,
      bundlePath: bundle.path
    };
  });
  summary.history = history;

  const finalState = await step('project_final_state', async () => {
    const validation = await request(host, 'project.validate', { projectId });
    const list = await request(host, 'project.list', {});
    const projects = list.projects ?? list;
    const found = projects.find((entry) => entry.id === projectId);
    if (!found) throw new Error('Project is missing from project.list.');
    await request(host, 'project.close', { projectId });
    return { valid: validation.valid ?? validation.ok ?? null, projectCount: projects.length, status: found.status ?? null };
  });
  summary.finalState = finalState;

  summary.dataRoot = DATA_ROOT;
  summary.livePublication = 'not-performed';
  summary.remoteQdnVerification = 'not-performed';
} catch (error) {
  failure = { message: error.message, code: error.code ?? null, data: error.data ?? null, stderr: host.stderr().slice(-3000) };
  console.error('ALPHA_STEP_FAILED ' + JSON.stringify(failure));
} finally {
  await host.stop();
  if (!KEEP) {
    // The evidence references the data root; keep it by default for audit.
  }
}

const report = {
  schema: 'qms-alpha-validation@1',
  ok: failure === null,
  product: 'Qortal Migration Studio',
  version: summary.engineVersion ?? null,
  channel: 'alpha',
  baseUrl: BASE_URL,
  dataRoot: DATA_ROOT,
  startedAt,
  finishedAt: new Date().toISOString(),
  livePublicationPerformed: false,
  remoteQdnVerified: false,
  limitation: 'This validation prepares and validates local QDN handoffs. It does not sign or publish; no fixture is reported as remote QDN verification.',
  summary,
  steps,
  failure
};
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, report: REPORT, steps: steps.length, projectId, failure }, null, 2));
if (!report.ok) process.exit(1);

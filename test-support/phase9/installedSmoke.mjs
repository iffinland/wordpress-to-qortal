/**
 * Installed-package smoke test.
 *
 * Runs the packaged engine over its real stdio JSON-RPC host against a local
 * deterministic WordPress fixture, then exercises project creation, source
 * validation/discovery, planning, media download, QDN handoff preparation,
 * sync/conflicts, recovery and cleanup preview. It never publishes or signs.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { startWordpressFixtureServer } from './fixtureServer.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const engineRoot = path.resolve(args.engine ?? process.env.QMS_ENGINE_ROOT ?? '');
const dataRoot = path.resolve(args['data-root'] ?? process.env.QMS_DATA_ROOT ?? '');
const reportPath = args.report ? path.resolve(args.report) : null;
if (!engineRoot || !dataRoot) {
  console.error('usage: installedSmoke.mjs --engine=<resources/engine> --data-root=<dir> [--report=<file>]');
  process.exit(2);
}
await mkdir(dataRoot, { recursive: true, mode: 0o700 });

const steps = [];
function record(name, detail) {
  steps.push({ name, ok: true, detail });
  console.log('SMOKE_STEP_OK ' + name + (detail ? ' ' + JSON.stringify(detail) : ''));
}

const fixture = await startWordpressFixtureServer({ port: 0, host: '127.0.0.1' });
record('wordpress_fixture_started', { url: fixture.url });

const child = spawn(process.execPath, [path.join(engineRoot, 'bin/qms-host.js')], {
  cwd: engineRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    QMS_DATA_ROOT: dataRoot,
    QMS_REPO_ROOT: engineRoot
  },
  stdio: ['pipe', 'pipe', 'pipe']
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
let nextId = 1;
const pending = new Map();
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += String(chunk); });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined || message.id === null) return;
  const waiter = pending.get(Number(message.id));
  if (!waiter) return;
  pending.delete(Number(message.id));
  clearTimeout(waiter.timer);
  if (message.error) {
    const error = new Error(message.error.message || 'engine error');
    error.code = message.error.data?.code ?? 'ENGINE_ERROR';
    error.data = message.error.data;
    waiter.reject(error);
  } else {
    waiter.resolve(message.result);
  }
});
function request(method, params = {}, timeoutMs = 120000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout: ' + method));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

let failure = null;
let summary = {};
try {
  const info = await request('engine.info');
  record('engine_info', { apiVersion: info.apiVersion, version: info.version, adapters: info.adapters?.map((entry) => entry.id) });

  const created = await request('project.create', {
    name: 'Installed Package Smoke',
    source: { adapter: 'wordpress', baseUrl: fixture.url },
    target: { qdnName: 'InstalledSmoke' },
    settings: {
      media: { allowLoopback: true, timeoutMs: 10000, maxRetries: 0 },
      planning: { batchSize: 10 },
      disk: { reserveBytes: 0, maxBytesPerRun: 2147483648, safetyFactor: 1, unknownSizePolicy: 'estimate', unknownSizeBytes: 1048576 }
    }
  });
  const projectId = created.id;
  record('project_created', { projectId, siteId: created.siteId });

  const opened = await request('project.open', { projectId });
  record('project_opened', { projectId: opened.project?.id });

  const validation = await request('source.validate', {
    projectId,
    adapterId: 'wordpress',
    auth: { mode: 'none' },
    source: { baseUrl: fixture.url }
  });
  record('wordpress_validated', { ok: validation.ok, counts: validation.counts });

  const discovery = await request('source.discover', {
    projectId,
    adapterId: 'wordpress',
    auth: { mode: 'none' },
    source: { baseUrl: fixture.url },
    contentTypes: ['post', 'page'],
    perPage: 20,
    maxItems: 20
  });
  record('source_discovered', { items: discovery.items?.length ?? discovery.count ?? null });

  const plan = await request('plan.create', {
    projectId,
    batchSize: 10,
    estimateMedia: true,
    persist: true,
    disk: { reserveBytes: 0, maxBytesPerRun: 2147483648, safetyFactor: 1, unknownSizePolicy: 'estimate', unknownSizeBytes: 1048576 }
  });
  const planId = plan.planId ?? plan.id;
  record('plan_created', { planId, entries: plan.entries?.length ?? null });

  const planList = await request('plan.list', { projectId, limit: 10 });
  const storedPlanId = planId ?? planList.plans?.[0]?.id ?? planList[0]?.id;
  const planDetail = await request('plan.get', { projectId, planId: storedPlanId });
  const entries = planDetail.entries ?? planDetail.plan?.entries ?? [];
  record('plan_loaded', { planId: storedPlanId, entries: entries.length });

  const media = await request('media.download', {
    projectId,
    planId: storedPlanId,
    concurrency: 2,
    disk: { reserveBytes: 0, maxBytesPerRun: 2147483648, safetyFactor: 1 },
    media: { allowLoopback: true, timeoutMs: 10000, maxRetries: 0 }
  });
  record('media_prepared', { downloaded: media.downloaded ?? media.count ?? null, failed: media.failed ?? null });

  const actionable = entries.filter((entry) => ['new', 'modified', 'route_changed', 'reserved'].includes(entry.status ?? entry.action));
  const selection = actionable.map((entry) => entry.sourceKey);
  const handoff = await request('publication.prepare', {
    projectId,
    planId: storedPlanId,
    selection,
    feePerResource: 0,
    feeCurrency: 'QORT'
  });
  const handoffId = handoff.handoffId ?? handoff.id;
  record('handoff_prepared', { handoffId, resources: handoff.estimate?.resourceCount ?? handoff.resources?.length ?? null });

  const handoffDetail = await request('publication.get', { projectId, handoffId, validate: true });
  record('handoff_validated', { handoffId, resources: handoffDetail.handoff?.resources?.length ?? null });

  const recovery = await request('recovery.status', { projectId });
  record('recovery_status', { stages: recovery.stages?.length ?? 0 });

  const preview = await request('cleanup.preview', { projectId, retentionDays: 0 });
  record('cleanup_preview', { entries: preview.entries?.length ?? 0 });

  const cleanup = await request('cleanup.start', { projectId, retentionDays: 0, dryRun: true });
  record('cleanup_dry_run', { cleanupId: cleanup.cleanupId ?? cleanup.id, dryRun: true });

  const sync = await request('sync.check', {
    projectId,
    mode: 'full',
    auth: { mode: 'none' },
    source: { baseUrl: fixture.url },
    query: {},
    contentTypes: ['post', 'page'],
    perPage: 20,
    maxItems: 20,
    autoApplyWithdrawals: false
  }, 300000);
  record('sync_checked', { scanId: sync.scanId, complete: sync.complete, counts: sync.counts ?? null });

  const conflicts = await request('sync.conflicts', { projectId, includeResolved: false });
  record('conflicts_listed', { count: conflicts.conflicts?.length ?? conflicts.length ?? 0 });

  const snapshot = await request('project.snapshot', { projectId });
  record('project_snapshot', { revision: snapshot.revision ?? snapshot.snapshot?.revision ?? null });

  summary = {
    projectId,
    planId: storedPlanId,
    handoffId,
    entries: entries.length,
    selection: selection.length
  };
} catch (error) {
  failure = { message: error.message, code: error.code ?? null, data: error.data ?? null, stderr: stderr.slice(-2000) };
  console.error('SMOKE_STEP_FAILED ' + JSON.stringify(failure));
}

try {
  child.stdin.end();
  child.kill('SIGTERM');
} catch { /* already stopped */ }
await new Promise((resolve) => {
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
  child.once('exit', () => { clearTimeout(timer); resolve(); });
});
await fixture.close();

const report = {
  schema: 'qms-installed-smoke@1',
  ok: failure === null,
  steps,
  failure,
  summary,
  engineRoot,
  dataRoot,
  finishedAt: new Date().toISOString()
};
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

#!/usr/bin/env node
/**
 * Packaged-Electron functional acceptance for the essential migration workflow.
 *
 * Drives the *packaged* app over CDP against deterministic WordPress fixtures and
 * asserts recorded state, not click outcomes:
 *
 *   A. direct "Run quick scan" indexes exactly three posts with dependencies
 *   B. "Confirm quick scan and continue" produces a valid three-post plan
 *   C. explicit Full inventory completes on a small fixture
 *   D. Pause -> Resume completes without duplicate index entries
 *   E. Cancel stops the run and preserves the project
 *   F. an interrupted Full checkpoint does not block a new Quick scan
 *   G. failure paths are visible next to the controls that failed
 *
 * The GUI runs with Xvfb from an isolated rootfs and the app natively (Electron
 * needs /proc). CDP is bound to 127.0.0.1 only for the run.
 */
import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../../lib/engine/index.js';
import { fixedDiskProbe } from '../../lib/engine/disk.js';
import { GIB } from '../../lib/engine/config.js';
import {
  createFixtureData,
  createLargeFixtureData,
  startWordpressFixtureServer
} from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function argument(name, fallback = null) {
  const entry = process.argv.find((value) => value.startsWith('--' + name + '='));
  return entry ? entry.slice(('--' + name + '=').length) : fallback;
}

const appDir = path.resolve(argument('app', path.join(REPO_ROOT, 'desktop/release/linux-unpacked')));
const rootfs = path.resolve(argument('rootfs', '/home/iffi/dev-workspace/tmp/qms-phase9-rootfs/trixie'));
const work = path.resolve(argument('work', '/tmp/qms-packaged-functional'));
const outFile = path.resolve(argument('out', path.join(work, 'functional-acceptance.json')));
const dataHome = path.join(work, 'datahome');
const dataRoot = path.join(dataHome, 'qortal-migration-studio');
const CDP_PORT = Number(argument('port', '9341'));
const only = argument('only', null);
const wanted = only ? new Set(only.split(',').map((value) => value.trim()).filter(Boolean)) : null;
const sessionScript = path.join(work, 'session.sh');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stage = (label, extra) => process.stderr.write('[stage] ' + label + (extra ? ' ' + JSON.stringify(extra) : '') + '\n');

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

async function startBadHtmlServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html><body><h1>Not a WordPress site</h1></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: 'http://127.0.0.1:' + address.port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startHangingPostsServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push(url.pathname);
    const sendJson = (body) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/wp-json/') {
      return sendJson({
        name: 'Slow fixture', description: 'timeout fixture', url: 'http://127.0.0.1',
        home: 'http://127.0.0.1', gmt_offset: 0, namespaces: ['wp/v2'], authentication: {},
        routes: { '/wp/v2/posts': {}, '/wp/v2/pages': {}, '/wp/v2/media': {} }
      });
    }
    if (url.pathname === '/wp-json/wp/v2/types') {
      return sendJson({
        post: { id: 1, name: 'Posts', rest_base: 'posts', rest_namespace: 'wp/v2' },
        page: { id: 2, name: 'Pages', rest_base: 'pages', rest_namespace: 'wp/v2' }
      });
    }
    // Never answer content or dependency requests: the client must time out.
    return undefined;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: 'http://127.0.0.1:' + address.port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// ---------------------------------------------------------------------------
// Engine seeding
// ---------------------------------------------------------------------------

function wizardState(serverUrl, options) {
  const contentTypes = options.contentTypes ?? ['post'];
  return {
    step: options.step ?? 4,
    completedSteps: options.completedSteps ?? [1, 2, 3],
    wizardVersion: 2,
    adapterId: 'wordpress',
    sourceUrl: options.sourceUrl ?? serverUrl,
    authMode: 'none',
    connection: options.connection ?? null,
    targetQdnName: options.qdnName,
    siteTitle: options.name,
    siteDescription: '',
    website: { cms: 'none', service: 'APP', tagline: 'fixture', accent: '#4da3ff' },
    preferences: {
      batchSize: options.batchSize ?? 3,
      contentTypes,
      after: '',
      before: '',
      includeReserved: false,
      allowExternalMedia: true,
      includeUnreferencedAttachments: false,
      concurrency: 2,
      reserveGib: 0,
      maxRunGib: 0,
      maxFileMib: 256,
      maxFiles: 500,
      unknownPolicy: 'cap'
    },
    planId: null,
    updatedAt: new Date().toISOString()
  };
}

async function seedCompletedQuickScan(projectId, { maxItems = 3 } = {}) {
  const engine = createEngine({ dataRoot, diskProbe: fixedDiskProbe(10 * GIB) });
  try {
    const handle = await engine.projects.open(projectId);
    const result = await handle.source.discover({
      mode: 'quick',
      contentTypes: ['post'],
      perPage: 100,
      selection: { perPage: 100, maxPages: 1, maxItems }
    });
    if (result.status !== 'completed') {
      throw new Error('seeded quick scan did not complete: ' + JSON.stringify(result.error ?? result.status));
    }
    return result;
  } finally {
    await engine.close().catch(() => {});
  }
}

async function seedProject(serverUrl, options) {
  const engine = createEngine({ dataRoot, diskProbe: fixedDiskProbe(10 * GIB) });
  try {
    const project = await engine.projects.create({
      name: options.name,
      source: {
        adapter: 'wordpress',
        baseUrl: serverUrl,
        ...(options.sourceExtra ?? {})
      },
      target: { qdnName: options.qdnName, siteName: options.name },
      settings: {
        disk: { reserveBytes: 0, maxBytesPerRun: 0 },
        media: { allowLoopback: true, allowExternalMedia: true, maxRetries: 0, retryDelayMs: 0 },
        desktopWizard: wizardState(serverUrl, options)
      }
    });
    return { projectId: project.id, siteId: project.siteId };
  } finally {
    await engine.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Recorded project state
// ---------------------------------------------------------------------------

async function projectState(projectId) {
  const root = path.join(dataRoot, 'projects', projectId);
  const snapshot = await readJson(path.join(root, 'state', 'snapshot.json'), {});
  // JournalStore snapshots wrap the live state: { state: { runs, events, ... } }
  // and are only flushed on close. The recovery checkpoint files are written at
  // every terminal/paused boundary while the packaged app still holds the
  // project lock, so they are the live truth for a running acceptance test.
  const stateRoot = snapshot.state ?? snapshot;
  const recoveryDir = path.join(root, 'recovery', 'runs');
  const recoveryFiles = await readdir(recoveryDir, { withFileTypes: true }).catch(() => []);
  const recoveryRuns = [];
  for (const entry of recoveryFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const record = await readJson(path.join(recoveryDir, entry.name), null);
    if (!record || !record.runId) continue;
    recoveryRuns.push({
      id: record.runId,
      kind: record.kind,
      state: record.status,
      phase: record.phase,
      meta: record.meta ?? null,
      step: record.step ?? null,
      resumable: record.resumable === true,
      error: null
    });
  }
  const snapshotRuns = Object.values(stateRoot.runs ?? {}).map((run) => ({
    id: run.id,
    kind: run.kind,
    state: run.state,
    phase: run.phase,
    meta: run.meta ?? null,
    step: null,
    resumable: false,
    error: run.error ?? null
  }));
  const byId = new Map(snapshotRuns.map((run) => [run.id, run]));
  for (const run of recoveryRuns) byId.set(run.id, run);
  const runs = [...byId.values()];
  const sourceDir = path.join(root, 'artifacts', 'source', 'wordpress');
  const latest = await readJson(path.join(sourceDir, 'latest.json'), null);
  const report = latest?.reportFile ? await readJson(path.join(sourceDir, latest.reportFile), null) : null;
  let index = null;
  if (latest?.indexFile) {
    index = await readJson(path.join(sourceDir, latest.indexFile), null);
  }
  const batchEntries = await readdir(path.join(sourceDir, 'batches'), { withFileTypes: true }).catch(() => []);
  const batches = batchEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const fullStateFiles = [];
  for (const batch of batches) {
    if (await exists(path.join(sourceDir, 'batches', batch, 'full-scan-state.json'))) {
      fullStateFiles.push({ batch, state: await readJson(path.join(sourceDir, 'batches', batch, 'full-scan-state.json'), null) });
    }
  }
  const keys = Array.isArray(index?.entries) ? index.entries.map((entry) => entry.sourceKey) : [];
  return {
    projectExists: await exists(path.join(root, 'project.json')),
    runs,
    latest,
    report,
    indexEntries: keys.length,
    duplicateIndexKeys: keys.length - new Set(keys).size,
    indexKeys: keys,
    batches,
    fullStateFiles
  };
}

// ---------------------------------------------------------------------------
// App lifecycle (Xvfb in a rootfs chroot, app native so /proc exists)
// ---------------------------------------------------------------------------

let child = null;
let cdp = null;

async function writeSessionScript() {
  const script = [
    '#!/bin/bash',
    'set -e',
    'R=' + JSON.stringify(rootfs),
    'APP=' + JSON.stringify(appDir),
    'W=' + JSON.stringify(work),
    'mkdir -p "$W/home" "$W/datahome" "$W/config" "$W/run"',
    'chmod 700 "$W/run"',
    'rm -rf "$W/config"; mkdir -p "$W/config"',
    'rm -f "$R/tmp/.X99-lock" "$R/tmp/.X11-unix/X99"',
    'setsid unshare -rmpf bash -c \'',
    '  R="\'"$R"\'"',
    '  mkdir -p "$R/tmp/.X11-unix" "$R/var/lib/xkb"',
    '  mount -t tmpfs -o mode=755 tmpfs "$R/dev" 2>/dev/null || true',
    '  exec /usr/sbin/chroot "$R" /usr/bin/Xvfb :99 -screen 0 1366x900x24 -listen tcp -ac',
    '\' >"$W/xvfb.log" 2>&1 &',
    'for i in $(seq 1 80); do (exec 3<>/dev/tcp/127.0.0.1/6099) 2>/dev/null && { exec 3>&-; break; }; sleep 0.25; done',
    'if ! (exec 3<>/dev/tcp/127.0.0.1/6099) 2>/dev/null; then echo XVFB_FAILED; cat "$W/xvfb.log"; exit 1; fi',
    'export HOME="$W/home" XDG_DATA_HOME="$W/datahome" XDG_CONFIG_HOME="$W/config" XDG_RUNTIME_DIR="$W/run"',
    'export DISPLAY=127.0.0.1:99',
    'LIBS="$R/usr/lib/x86_64-linux-gnu:$R/lib/x86_64-linux-gnu"',
    'exec env LD_LIBRARY_PATH="$LIBS:$APP" "$APP/qortal-migration-studio" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=' + CDP_PORT + ' --remote-allow-origins=* >"$W/app.log" 2>&1'
  ].join('\n');
  await writeFile(sessionScript, script + '\n', { mode: 0o755 });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
    this.ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params?.exceptionDetails?.text ?? 'exception');
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error('renderer evaluate failed: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
    }
    return result.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(300);
  }
  throw new Error('timed out waiting for ' + url);
}

async function connectCdp() {
  await waitForHttp('http://127.0.0.1:' + CDP_PORT + '/json/list');
  const started = Date.now();
  let page = null;
  while (Date.now() - started < 60000) {
    try {
      const targets = await waitForHttp('http://127.0.0.1:' + CDP_PORT + '/json/list', 5000);
      page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl) ?? null;
      if (page) break;
    } catch {}
    await sleep(250);
  }
  if (!page) throw new Error('no page target in CDP list');
  const connection = new Cdp(page.webSocketDebuggerUrl);
  await connection.ready;
  await connection.send('Runtime.enable');
  return connection;
}

async function startApp() {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await writeSessionScript();
      child = spawn('bash', [sessionScript], { detached: true, stdio: 'ignore', env: { ...process.env } });
      cdp = await connectCdp();
      await waitFor(cdp, 'document.querySelector("[data-testid=app-shell]") !== null', 'app shell', 90000);
      return;
    } catch (error) {
      lastError = error;
      stage('app start attempt ' + attempt + ' failed', { error: String(error?.message ?? error) });
      await stopApp().catch(() => {});
      await sleep(1500 + attempt * 1000);
    }
  }
  throw lastError ?? new Error('packaged app did not start');
}

async function waitForNoApp(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let pids = '';
    try {
      pids = execFileSync('pgrep', ['-f', '^' + appDir + '/qortal-migration-studio'], { encoding: 'utf8' }).trim();
    } catch {}
    if (pids === '') return true;
    await sleep(250);
  }
  return false;
}

async function stopApp() {
  if (cdp) {
    await Promise.race([cdp.evaluate('window.close()').catch(() => {}), sleep(2000)]);
    cdp.close();
    cdp = null;
  }
  if (child) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 8000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    child = null;
  }
  try { execFileSync('pkill', ['-f', '^' + appDir + '/qortal-migration-studio'], { stdio: 'ignore' }); } catch {}
  try { execFileSync('pkill', ['-f', 'Xvfb :99'], { stdio: 'ignore' }); } catch {}
  // The packaged app is single-instance. Starting the next session before the
  // previous process is gone makes the new instance exit immediately, which
  // looks like a product failure. Prove the old process group is gone first.
  if (!(await waitForNoApp(25000))) {
    stage('app did not exit after stop', { appDir });
  }
  await sleep(800);
}

async function waitFor(connection, expression, label, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await connection.evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(200);
  }
  throw new Error('timed out waiting for ' + label);
}

function clickButton(label) {
  return '(() => { const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === ' + JSON.stringify(label) + '); if (!button || button.disabled) return false; button.click(); return true; })()';
}

async function click(connection, label) {
  const clicked = await waitFor(connection, clickButton(label), 'click ' + label);
  if (!clicked) throw new Error('could not click ' + label);
}

async function openProject(connection, projectId) {
  const card = '[data-testid="project-' + projectId + '"]';
  await waitFor(connection, '!!document.querySelector(' + JSON.stringify(card) + ')', 'project card ' + projectId);
  const opened = await connection.evaluate('(() => { const card = document.querySelector(' + JSON.stringify(card) + '); const button = [...card.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "Open"); if (!button) return false; button.click(); return true; })()');
  if (!opened) throw new Error('Open button missing for ' + projectId);
  await sleep(600);
  return connection.evaluate('({ text: document.body.innerText.slice(0, 400), dashboard: document.body.innerText.includes("Your migration projects") })');
}

async function openWizardStep(connection, projectId, marker) {
  await openProject(connection, projectId);
  await waitFor(connection, 'document.body.innerText.includes(' + JSON.stringify(marker) + ')', 'wizard marker ' + marker, 120000);
}

async function backToDashboard(connection) {
  await click(connection, 'Dashboard');
  await waitFor(connection, 'document.body.innerText.includes("Your migration projects")', 'dashboard', 60000);
}

async function setValue(connection, selectorExpression, value, inputKind = 'HTMLInputElement') {
  return connection.evaluate('(() => { const input = ' + selectorExpression + '; if (!input) return false; const setter = Object.getOwnPropertyDescriptor(window.' + inputKind + '.prototype, "value").set; setter.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
}

function inputByLabel(labelText) {
  return '(() => { const label = [...document.querySelectorAll("label")].find((node) => (node.innerText || "").includes(' + JSON.stringify(labelText) + ')); return label ? label.querySelector("input, textarea") : null; })()';
}

async function setInputByLabel(connection, labelText, value, kind = 'HTMLInputElement') {
  const ok = await setValue(connection, inputByLabel(labelText), value, kind);
  if (!ok) throw new Error('input not found: ' + labelText);
}

async function scanSnapshot(connection) {
  return connection.evaluate('(() => { const panel = document.querySelector("[data-testid=source-scan]"); const error = document.querySelector("[data-testid=scan-error]"); return { text: panel ? panel.innerText : "", error: error ? error.innerText : null, telemetry: (document.querySelector("[data-testid=scan-telemetry]") || {}).innerText || null, body: document.body.innerText }; })()');
}

async function waitScanOutcome(connection, timeoutMs = 240000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await scanSnapshot(connection);
    if (last.error) return { outcome: 'error', ...last };
    // Older builds render the failure only above the (long) wizard step; detect
    // the same engine error text so the harness reports the real cause instead
    // of waiting for a completion that can never arrive.
    if (/An explicit scan mode is required|Source scan failed|Resume failed|Engine host is not running|Engine host connection closed|Source scan did not complete/i.test(last.body)) {
      return { outcome: 'error', ...last };
    }
    if (/Quick scan complete within its request budget|Full inventory complete|Last completed (quick|full)/.test(last.body)) {
      return { outcome: 'completed', ...last };
    }
    if (last.body.includes('Scan cancelled.')) return { outcome: 'cancelled', ...last };
    await sleep(300);
  }
  throw new Error('scan did not settle: ' + JSON.stringify(last?.text?.slice(0, 400)));
}

async function clickScanRadio(connection, labelText) {
  const ok = await connection.evaluate('(() => { const label = [...document.querySelectorAll("label")].find((node) => (node.innerText || "").includes(' + JSON.stringify(labelText) + ')); if (!label) return false; const input = label.querySelector("input"); if (!input) return false; input.click(); return true; })()');
  if (!ok) throw new Error('scan radio not found: ' + labelText);
  await sleep(300);
}

async function tickCheckbox(connection, labelText) {
  const ok = await connection.evaluate('(() => { const label = [...document.querySelectorAll("label")].find((node) => (node.innerText || "").includes(' + JSON.stringify(labelText) + ')); if (!label) return false; const input = label.querySelector("input[type=checkbox]"); if (!input) return false; input.click(); return true; })()');
  if (!ok) throw new Error('checkbox not found: ' + labelText);
  await sleep(250);
}

async function setQuickLimit(connection, limit) {
  await setInputByLabel(connection, 'Index up to', String(limit));
}

async function waitPauseReady(connection, timeoutMs = 60000) {
  return waitFor(connection, '!![...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "Pause" && !entry.disabled)', 'pause enabled', timeoutMs);
}

async function startFullInventory(connection) {
  await clickScanRadio(connection, 'Full site inventory');
  await tickCheckbox(connection, 'I understand this can crawl the entire site');
  await click(connection, 'Run full inventory');
}

async function waitInterruptedBanner(connection, timeoutMs = 60000) {
  return waitFor(connection, '!!document.querySelector("[data-testid=interrupted-scan]")', 'interrupted scan banner', timeoutMs);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const evidence = {
  schema: 'qms-packaged-functional-acceptance@1',
  startedAt: new Date().toISOString(),
  environment: { appDir, rootfs, work },
  controls: {}
};

const results = {};
const failures = [];

async function record(name, label, body) {
  if (wanted && !wanted.has(name)) {
    results[name] = { control: label, status: 'SKIPPED' };
    return;
  }
  try {
    const value = await body();
    results[name] = { control: label, status: 'PASS', ...value };
    stage(name + ' PASS');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results[name] = { control: label, status: 'FAIL', error: message, rendererExceptions: cdp?.exceptions ?? [] };
    failures.push(name + ': ' + message);
    stage(name + ' FAIL', { error: message });
  }
}

async function main() {
  await rm(work, { recursive: true, force: true });
  await mkdir(dataHome, { recursive: true });

  const small = await startWordpressFixtureServer({ data: createFixtureData() });
  const medium = await startWordpressFixtureServer({
    data: createLargeFixtureData({ posts: 1200, media: 600, categories: 60, tags: 12 }),
    delayMs: 300
  });
  const badHtml = await startBadHtmlServer();
  const hanging = await startHangingPostsServer();
  // NASA-shaped source: its REST API returns fewer rows than per_page even
  // though X-WP-Total advertises tens of thousands. A three-item quick scan
  // must still index three.
  const shortPage = await startWordpressFixtureServer({
    data: createLargeFixtureData({ posts: 35_600, media: 60, categories: 20, tags: 5 }),
    partialPages: { posts: 0.45 }
  });

  const projects = {};
  const seed = async (key, server, options) => {
    projects[key] = await seedProject(server.url, options);
    return projects[key];
  };

  try {
    await seed('A', small, { name: 'Functional A quick', qdnName: 'FunctionalAQuick', contentTypes: ['post'] });
    await seed('B', small, { name: 'Functional B confirm', qdnName: 'FunctionalBConfirm', contentTypes: ['post'], batchSize: 3 });
    await seed('C', small, { name: 'Functional C full', qdnName: 'FunctionalCFull', contentTypes: ['post', 'page'] });
    await seed('D', medium, { name: 'Functional D pause', qdnName: 'FunctionalDPause', contentTypes: ['post'], batchSize: 300 });
    await seed('E', medium, { name: 'Functional E cancel', qdnName: 'FunctionalECancel', contentTypes: ['post'], batchSize: 300 });
    await seed('F', medium, { name: 'Functional F restart', qdnName: 'FunctionalFRestart', contentTypes: ['post'], batchSize: 300 });
    await seed('G1', small, { name: 'Functional G1 connection', qdnName: 'FunctionalG1Conn', step: 2, completedSteps: [1], sourceUrl: 'http://127.0.0.1:9' });
    await seed('G2', badHtml, { name: 'Functional G2 invalid', qdnName: 'FunctionalG2Invalid', step: 2, completedSteps: [1] });
    await seed('G3', hanging, { name: 'Functional G3 timeout', qdnName: 'FunctionalG3Timeout', contentTypes: ['post'], step: 4, sourceExtra: { timeoutMs: 1200 } });
    await seed('G4', small, { name: 'Functional G4 engine', qdnName: 'FunctionalG4Engine', contentTypes: ['post'] });
    await seed('I', small, { name: 'Functional I plan review', qdnName: 'FunctionalIPlanReview', contentTypes: ['post'], batchSize: 3 });
    await seed('J', shortPage, { name: 'Functional J short page', qdnName: 'FunctionalJShortPage', contentTypes: ['post'], batchSize: 3 });

    evidence.projects = projects;
    evidence.fixtures = { small: small.url, medium: medium.url, badHtml: badHtml.url, hanging: hanging.url };
    stage('fixtures and projects ready');

    // ---------------- Session 1: A, B, C ----------------
    await startApp();
    await openWizardStep(cdp, projects.A.projectId, 'Import preferences');
    await record('A', 'Direct Run quick scan', async () => {
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Run quick scan');
      const outcome = await waitScanOutcome(cdp);
      if (outcome.outcome !== 'completed') throw new Error('quick scan did not complete: ' + outcome.outcome + ' ' + (outcome.error ?? ''));
      const state = await projectState(projects.A.projectId);
      const completed = state.runs.filter((run) => run.kind === 'source.discover' && run.state === 'completed');
      if (completed.length !== 1) throw new Error('expected one completed discovery run, saw ' + completed.length);
      if (!state.latest || state.latest.mode !== 'quick') throw new Error('latest scan is not quick: ' + JSON.stringify(state.latest?.mode));
      const counts = state.report?.counts ?? {};
      if (Number(counts.posts) !== 3) throw new Error('expected 3 indexed posts, saw ' + counts.posts);
      if (Number(counts.categories) + Number(counts.tags) < 1) throw new Error('no referenced taxonomy indexed');
      if (Number(counts.media) < 1) throw new Error('no referenced media dependency indexed');
      if (state.duplicateIndexKeys !== 0) throw new Error('duplicate index keys: ' + state.duplicateIndexKeys);
      return { outcome: 'completed', ui: { scan: outcome.text.slice(0, 500), telemetry: outcome.telemetry }, run: completed[0].id, latest: { mode: state.latest.mode, batchId: state.latest.batchId, counts, scope: state.latest.scope }, indexEntries: state.indexEntries, duplicateIndexKeys: state.duplicateIndexKeys };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.B.projectId, 'Import preferences');
    await record('B', 'Confirm quick scan and continue', async () => {
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Continue');
      await waitFor(cdp, '!!document.querySelector("[data-testid=scan-confirmation]")', 'scan confirmation', 30000);
      await click(cdp, 'Confirm quick scan and continue');
      await waitFor(cdp, '!!document.querySelector("[data-testid=plan-review]")', 'plan review', 180000);
      const review = await cdp.evaluate('(() => { const panel = document.querySelector("[data-testid=plan-review]"); const badge = panel ? panel.querySelector(".badge") : null; return { text: panel ? panel.innerText : "", badge: badge ? badge.innerText.trim() : null }; })()');
      const text = review.text;
      if (!/Selected:\s*3\b/.test(text)) throw new Error('plan did not select 3 items: ' + text.slice(0, 400));
      if (review.badge !== 'ready') throw new Error('plan status is ' + review.badge + ': ' + text.slice(0, 400));
      const state = await projectState(projects.B.projectId);
      const completed = state.runs.filter((run) => run.kind === 'source.discover' && run.state === 'completed');
      if (completed.length !== 1) throw new Error('expected one completed discovery run');
      return { planText: text.slice(0, 600), latest: { mode: state.latest?.mode, counts: state.report?.counts } };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.C.projectId, 'Import preferences');
    await record('C', 'Full inventory on a small fixture', async () => {
      await startFullInventory(cdp);
      const outcome = await waitScanOutcome(cdp, 300000);
      if (outcome.outcome !== 'completed') throw new Error('full inventory did not complete: ' + outcome.outcome + ' ' + (outcome.error ?? ''));
      const state = await projectState(projects.C.projectId);
      const completed = state.runs.filter((run) => run.kind === 'source.discover' && run.state === 'completed');
      if (completed.length !== 1) throw new Error('expected one completed discovery run');
      if (state.latest?.mode !== 'full') throw new Error('latest scan is not full: ' + state.latest?.mode);
      const counts = state.report?.counts ?? {};
      if (Number(counts.posts) !== 3 || Number(counts.pages) !== 2) {
        throw new Error('unexpected full-inventory counts: ' + JSON.stringify(counts));
      }
      return { outcome: 'completed', counts, latest: { mode: state.latest.mode, batchId: state.latest.batchId }, ui: outcome.text.slice(0, 400) };
    });
    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.I.projectId, 'Import preferences');
    await record('I', 'Plan Review entry: one plan.create, no stale error (BUG-005)', async () => {
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Run quick scan');
      const scanOutcome = await waitScanOutcome(cdp, 180000);
      if (scanOutcome.outcome !== 'completed') throw new Error('quick scan did not complete: ' + scanOutcome.outcome + ' ' + (scanOutcome.error ?? ''));
      const scanPanel = await cdp.evaluate('document.querySelector("[data-testid=source-scan]").innerText');
      if (!/Posts indexed:\s*3\b/.test(scanPanel)) throw new Error('quick scan indexed fewer than three posts: ' + scanPanel.slice(0, 800));

      // Import preferences -> Plan Review. This is the path that used to
      // start two plan.create operations and leave "Another plan.create..."
      // beside a ready plan.
      await click(cdp, 'Continue');
      await waitFor(cdp, '!!document.querySelector("[data-testid=plan-review]")', 'plan review', 180000);
      await waitFor(cdp, '(() => { const p = document.querySelector("[data-testid=plan-review]"); const b = p && p.querySelector(".badge"); return !!b && !!b.innerText.trim(); })()', 'plan badge', 60000);
      await sleep(2000);
      const review = await cdp.evaluate('(() => { const panel = document.querySelector("[data-testid=plan-review]"); const badge = panel ? panel.querySelector(".badge") : null; return { text: panel ? panel.innerText : "", badge: badge ? badge.innerText.trim() : null, body: document.body.innerText }; })()');
      const state = await projectState(projects.I.projectId);
      const planRuns = state.runs.filter((run) => run.kind === 'plan.create');
      const planError = /Another plan\.create[^\n]*/.exec(review.body)?.[0] ?? null;
      if (review.badge !== 'ready') throw new Error('plan status is ' + review.badge + ': ' + review.text.slice(0, 600));
      if (!/Selected:\s*3\b/.test(review.text)) throw new Error('plan did not select 3 items: ' + review.text.slice(0, 600));
      if (planError) throw new Error('stale plan.create error rendered: ' + planError);
      if (/Planning failed/.test(review.body)) throw new Error('planning failure banner rendered next to a ready plan');
      if (planRuns.length !== 1) throw new Error('expected exactly one plan.create run, saw ' + planRuns.length);
      return {
        badge: review.badge,
        planRuns: planRuns.length,
        planText: review.text.slice(0, 700),
        scanPanel: scanPanel.slice(0, 500),
        stalePlanError: null
      };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.J.projectId, 'Import preferences');
    await record('J', 'NASA-shaped short page still fills the requested window', async () => {
      await setQuickLimit(cdp, 3);
      const requestsBefore = shortPage.requests.length;
      await click(cdp, 'Run quick scan');
      const outcome = await waitScanOutcome(cdp, 180000);
      if (outcome.outcome !== 'completed') throw new Error('short-page quick scan did not complete: ' + outcome.outcome + ' ' + (outcome.error ?? ''));
      const panel = await cdp.evaluate('document.querySelector("[data-testid=source-scan]").innerText');
      const state = await projectState(projects.J.projectId);
      const postRequests = shortPage.requests.slice(requestsBefore).filter((request) => request.path.endsWith('/wp-json/wp/v2/posts'));
      const result = {
        panel: panel.slice(0, 600),
        counts: state.report?.counts ?? null,
        scope: state.report?.scope ?? null,
        postRequests: postRequests.map((request) => ({ per_page: request.query.per_page, page: request.query.page })),
        underReturnedNotice: /Source returned a short page|returned fewer|QMS indexed exactly/.test(panel)
      };
      if (!/Posts indexed:\s*3\b/.test(panel)) throw new Error('short-page source indexed fewer than three posts: ' + JSON.stringify(result));
      if (Number(state.report?.counts?.posts) !== 3) throw new Error('recorded short-page count is ' + state.report?.counts?.posts);
      if (postRequests.length !== 1 || postRequests[0].query.per_page !== '100') {
        throw new Error('quick scan did not request one full page: ' + JSON.stringify(result));
      }
      return result;
    });
    await stopApp();

    // ---------------- Session 2: D, E, F ----------------
    await startApp();
    await openWizardStep(cdp, projects.D.projectId, 'Import preferences');
    await record('D', 'Pause then Resume', async () => {
      await startFullInventory(cdp);
      await waitPauseReady(cdp, 90000);
      const beforePause = medium.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/posts')).length;
      await click(cdp, 'Pause');
      await waitFor(cdp, 'document.body.innerText.includes("Scan paused at the last durable checkpoint")', 'paused acknowledgement', 120000);
      await waitInterruptedBanner(cdp, 60000);
      await click(cdp, 'Resume interrupted scan from checkpoint');
      const outcome = await waitScanOutcome(cdp, 300000);
      if (outcome.outcome !== 'completed') throw new Error('resume did not complete: ' + outcome.outcome + ' ' + (outcome.error ?? ''));
      const state = await projectState(projects.D.projectId);
      const completed = state.runs.filter((run) => run.kind === 'source.discover' && run.state === 'completed');
      if (completed.length !== 1) throw new Error('expected one completed discovery run after resume, saw ' + completed.length);
      if (state.latest?.mode !== 'full') throw new Error('resumed scan is not full');
      if (Number(state.report?.counts?.posts) !== 1200) throw new Error('resumed index has ' + state.report?.counts?.posts + ' posts');
      if (state.duplicateIndexKeys !== 0) throw new Error('resume duplicated ' + state.duplicateIndexKeys + ' index keys');
      const afterResume = medium.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/posts')).length;
      return { outcome: 'completed', postsRequestsBeforePause: beforePause, postsRequestsAfterResume: afterResume, counts: state.report?.counts, duplicates: state.duplicateIndexKeys };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.E.projectId, 'Import preferences');
    await record('E', 'Cancel a running scan', async () => {
      await startFullInventory(cdp);
      await waitPauseReady(cdp, 90000);
      await click(cdp, 'Cancel scan');
      await waitFor(cdp, 'document.body.innerText.includes("Scan cancelled.")', 'cancel acknowledgement', 120000);
      const started = Date.now();
      let state = null;
      while (Date.now() - started < 60000) {
        state = await projectState(projects.E.projectId);
        if (state.runs.some((run) => run.kind === 'source.discover' && run.state === 'cancelled')) break;
        await sleep(500);
      }
      if (!state?.runs.some((run) => run.kind === 'source.discover' && run.state === 'cancelled')) throw new Error('no cancelled discovery run recorded');
      if (!state.projectExists) throw new Error('project was not preserved');
      if (state.latest?.runId && state.latest.runId === state.runs.find((run) => run.state === 'cancelled')?.id) throw new Error('cancelled run became latest');
      return { cancelled: true, projectExists: state.projectExists, latestBeforeCancel: state.latest?.batchId ?? null };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.F.projectId, 'Import preferences');
    await record('F', 'Interrupted Full checkpoint, then independent Quick scan', async () => {
      await startFullInventory(cdp);
      // Pause only after the full scan has a durable content cursor. Pausing at
      // 'connect' produces a checkpoint without full-scan-state.json, which is
      // not the owner's situation and does not prove the foreign-checkpoint case.
      const started = Date.now();
      let progressed = null;
      while (Date.now() - started < 120000) {
        progressed = await projectState(projects.F.projectId);
        const full = progressed.fullStateFiles[0]?.state ?? null;
        if (full && Number(full.contentProcessed ?? 0) > 0) break;
        await sleep(500);
      }
      const full = progressed?.fullStateFiles[0]?.state ?? null;
      if (!full || Number(full.contentProcessed ?? 0) === 0) {
        throw new Error('full inventory did not reach a content checkpoint before pause');
      }
      await waitPauseReady(cdp, 90000);
      await click(cdp, 'Pause');
      await waitFor(cdp, 'document.body.innerText.includes("Scan paused at the last durable checkpoint")', 'paused acknowledgement', 120000);
      const pausedState = await projectState(projects.F.projectId);
      const pausedRun = pausedState.runs.find((run) => run.kind === 'source.discover' && run.state === 'paused');
      if (!pausedRun) throw new Error('no paused full run before restart');
      const pausedBatch = pausedState.fullStateFiles[0] ?? null;
      if (!pausedBatch) throw new Error('no full-scan-state.json before restart');

      await stopApp();
      await startApp();
      await openWizardStep(cdp, projects.F.projectId, 'Import preferences');
      await waitInterruptedBanner(cdp, 120000);
      const banner = await cdp.evaluate('document.querySelector("[data-testid=interrupted-scan]").innerText');
      if (!/full/i.test(banner)) throw new Error('interrupted banner does not describe the full checkpoint: ' + banner);
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Run quick scan');
      const outcome = await waitScanOutcome(cdp, 180000);
      if (outcome.outcome !== 'completed') throw new Error('new quick scan failed while a full checkpoint existed: ' + outcome.outcome + ' ' + (outcome.error ?? ''));
      const state = await projectState(projects.F.projectId);
      const quick = state.runs.find((run) => run.kind === 'source.discover' && run.state === 'completed' && run.meta?.mode === 'quick');
      if (!quick) throw new Error('no completed quick run');
      if (state.latest?.mode !== 'quick') throw new Error('latest is not the new quick scan');
      const stillPaused = state.runs.find((run) => run.id === pausedRun.id);
      if (stillPaused?.state !== 'paused') throw new Error('full checkpoint changed state: ' + stillPaused?.state);
      if (!state.fullStateFiles.some((entry) => entry.batch === pausedBatch.batch)) throw new Error('full checkpoint file disappeared');
      if (Number(state.report?.counts?.posts) !== 3) throw new Error('quick scan indexed ' + state.report?.counts?.posts + ' posts');
      return { quickRun: quick.id, quickMode: state.latest.mode, quickCounts: state.report?.counts, pausedRunStillPaused: true, fullCheckpointPreserved: pausedBatch.batch, banner };
    });
    await stopApp();

    // ---------------- Session 3: G failure paths ----------------
    await startApp();
    await openWizardStep(cdp, projects.G1.projectId, 'Connect to WordPress');
    await record('G1', 'Connection failure is visible', async () => {
      await setInputByLabel(cdp, 'WordPress site URL', 'http://127.0.0.1:9');
      await click(cdp, 'Test connection');
      const panel = await waitFor(cdp, '(() => { const card = [...document.querySelectorAll(".card")].find((node) => node.innerText.includes("Connect to WordPress")); if (!card) return false; const alert = card.querySelector("[role=alert], .alert"); return alert ? { text: card.innerText.slice(0, 2000), alert: alert.innerText } : false; })()', 'connection error', 60000);
      if (!/SOURCE_|Connection failed|Could not reach/i.test(panel.alert)) throw new Error('no actionable connection error: ' + panel.alert.slice(0, 400));
      return panel;
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.G2.projectId, 'Connect to WordPress');
    await record('G2', 'Invalid source is visible', async () => {
      await setInputByLabel(cdp, 'WordPress site URL', badHtml.url);
      await click(cdp, 'Test connection');
      const panel = await waitFor(cdp, '(() => { const card = [...document.querySelectorAll(".card")].find((node) => node.innerText.includes("Connect to WordPress")); if (!card) return false; const alert = card.querySelector("[role=alert], .alert"); return alert ? { text: card.innerText.slice(0, 2000), alert: alert.innerText } : false; })()', 'invalid source error', 60000);
      if (!/SOURCE_|not a WordPress|invalid/i.test(panel.alert)) throw new Error('no actionable invalid-source error: ' + panel.alert.slice(0, 400));
      return panel;
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.G3.projectId, 'Import preferences');
    await record('G3', 'API timeout is visible next to the scan controls', async () => {
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Run quick scan');
      const outcome = await waitScanOutcome(cdp, 60000);
      if (outcome.outcome !== 'error') throw new Error('timeout scan did not surface an error: ' + outcome.outcome);
      if (!/SOURCE_TIMEOUT|timed out/i.test(outcome.error ?? '')) throw new Error('error is not a timeout: ' + outcome.error);
      const inPanel = await cdp.evaluate('(() => { const panel = document.querySelector("[data-testid=source-scan]"); const error = document.querySelector("[data-testid=scan-error]"); return !!panel && !!error && panel.contains(error); })()');
      if (!inPanel) throw new Error('scan error is not rendered inside the source-scan controls');
      return { error: outcome.error, visibleInScanPanel: inPanel };
    });

    await backToDashboard(cdp);
    await openWizardStep(cdp, projects.G4.projectId, 'Import preferences');
    await record('G4', 'Engine failure is visible', async () => {
      const pids = execFileSync('pgrep', ['-f', 'resources/engine/bin/qms-host.js'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
      if (pids.length === 0) throw new Error('engine host process not found');
      for (const pid of pids) { try { process.kill(Number(pid), 'SIGKILL'); } catch {} }
      await sleep(1200);
      await setQuickLimit(cdp, 3);
      await click(cdp, 'Run quick scan');
      const outcome = await waitScanOutcome(cdp, 60000);
      if (outcome.outcome !== 'error') throw new Error('engine failure did not surface an error: ' + outcome.outcome);
      if (!/Engine host|not running|closed/i.test(outcome.error ?? '')) throw new Error('unexpected engine error: ' + outcome.error);
      return { error: outcome.error };
    });
    await stopApp();
  } finally {
    await small.close().catch(() => {});
    await medium.close().catch(() => {});
    await badHtml.close().catch(() => {});
    await hanging.close().catch(() => {});
    await shortPage.close().catch(() => {});
  }
}

try {
  await main();
  evidence.controls = results;
  evidence.failures = failures;
  evidence.status = failures.length === 0 ? 'pass' : 'fail';
  evidence.finishedAt = new Date().toISOString();
  await mkdir(work, { recursive: true });
  await writeFile(outFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, out: outFile, failures }, null, 2));
  if (evidence.status !== 'pass') process.exit(1);
} catch (error) {
  evidence.controls = results;
  evidence.failures = failures;
  evidence.status = 'fail';
  evidence.fatal = error instanceof Error ? (error.stack ?? error.message) : String(error);
  evidence.finishedAt = new Date().toISOString();
  await mkdir(work, { recursive: true }).catch(() => {});
  await writeFile(outFile, JSON.stringify(evidence, null, 2) + '\n').catch(() => {});
  await stopApp().catch(() => {});
  console.error(JSON.stringify({ status: 'fail', out: outFile, fatal: evidence.fatal }, null, 2));
  process.exit(1);
}

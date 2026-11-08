#!/usr/bin/env node
/**
 * Real packaged-Electron acceptance test for bounded source scans and
 * pause/resume (owner report: a NASA-scale site started an unbounded crawl).
 *
 * Seeds a NASA-shaped WordPress fixture (36,000 posts, 250,000 media,
 * 2,053 categories) and drives the *packaged* app through the UI over CDP:
 *
 *  A. Continue must not start any crawl: the review panel appears and the
 *     fixture records zero content requests.
 *  B. Confirming the bounded quick scan completes with one content page and
 *     only referenced taxonomy/media lookups (asserted from the server log).
 *  C. A second project pauses at a safe boundary, the app quits, restarts and
 *     resumes from the checkpoint without re-fetching a completed page.
 *
 * The GUI runs in an isolated Debian rootfs with Xvfb (no host package or
 * display changes). CDP is bound to 127.0.0.1 only for the duration of the run.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../../lib/engine/index.js';
import { fixedDiskProbe } from '../../lib/engine/disk.js';
import { GIB } from '../../lib/engine/config.js';
import { createLargeFixtureData, startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function argument(name, fallback = null) {
  const entry = process.argv.find((value) => value.startsWith('--' + name + '='));
  return entry ? entry.slice(('--' + name + '=').length) : fallback;
}

const appDir = path.resolve(argument('app', path.join(REPO_ROOT, 'desktop/release/linux-unpacked')));
const rootfs = path.resolve(argument('rootfs', '/home/iffi/dev-workspace/tmp/qms-phase9-rootfs/trixie'));
const work = path.resolve(argument('work', '/tmp/qms-packaged-bounded-scan'));
const dataHome = path.join(work, 'datahome');
const dataRoot = path.join(dataHome, 'qortal-migration-studio');
const outFile = path.resolve(argument('out', path.join(work, 'packaged-bounded-scan-e2e.json')));
const sessionScript = path.join(work, 'session.sh');
const CDP_PORT = Number(argument('port', '9334'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function fixtureRequestCounts(server) {
  const posts = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/posts'));
  const categories = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/categories'));
  const tags = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/tags'));
  const media = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/media'));
  return {
    total: server.requests.length,
    posts: posts.length,
    postPages: posts.map((request) => request.query.page ?? null),
    postPerPage: posts.map((request) => request.query.per_page ?? null),
    categories: categories.length,
    categoryIncludesOnly: categories.every((request) => Boolean(request.query.include)),
    tags: tags.length,
    tagIncludesOnly: tags.every((request) => Boolean(request.query.include)),
    media: media.length,
    mediaIncludesOnly: media.every((request) => Boolean(request.query.include))
  };
}

async function seedProject(server, name, qdnName) {
  const engine = createEngine({ dataRoot, diskProbe: fixedDiskProbe(10 * GIB) });
  try {
    const project = await engine.projects.create({
      name,
      source: { adapter: 'wordpress', baseUrl: server.url },
      target: { qdnName, siteName: name },
      settings: { fixture: true, disk: { reserveBytes: 0, maxBytesPerRun: 0 } }
    });
    return { projectId: project.id, siteId: project.siteId };
  } finally {
    await engine.close().catch(() => {});
  }
}

async function writeSessionScript() {
  const inner = [
    'set -e',
    'export HOME=/home/qms',
    'export XDG_DATA_HOME=/mnt/datahome',
    'export XDG_CONFIG_HOME=/home/qms/.config',
    'export DISPLAY=:99',
    'export ELECTRON_DISABLE_SECURITY_WARNINGS=1',
    'Xvfb :99 -screen 0 1366x900x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &',
    'for i in $(seq 1 60); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.2; done',
    '[ -S /tmp/.X11-unix/X99 ] || { echo XVFB_FAILED; cat /tmp/xvfb.log; exit 1; }',
    'exec /opt/qms-e2e/app/qortal-migration-studio --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=' + CDP_PORT + ' --remote-allow-origins=*'
  ].join('\n');
  const outer = [
    'set -e',
    'R="$ROOTFS"',
    'APP_DIR="$APP_DIR"',
    'DATA_HOME="$DATA_HOME"',
    'mkdir -p "$DATA_HOME"',
    'mount -t proc proc "$R/proc" 2>/dev/null || true',
    'mount -t tmpfs -o mode=755 tmpfs "$R/dev" 2>/dev/null || true',
    'for d in null zero full random urandom tty ptmx; do',
    '  [ -e "$R/dev/$d" ] || touch "$R/dev/$d"',
    '  chmod 666 "$R/dev/$d" 2>/dev/null || true',
    '  mount --bind "/dev/$d" "$R/dev/$d" 2>/dev/null || true',
    'done',
    'mkdir -p "$R/dev/pts" "$R/dev/shm" "$R/opt/qms-e2e/app" "$R/mnt/datahome" "$R/home/qms/.config" "$R/tmp/.X11-unix"',
    'mount -t tmpfs -o mode=1777 tmpfs "$R/dev/shm" 2>/dev/null || true',
    'mount -t devpts devpts "$R/dev/pts" 2>/dev/null || true',
    'mount --bind "$APP_DIR" "$R/opt/qms-e2e/app"',
    'mount --bind "$DATA_HOME" "$R/mnt/datahome"',
    'rm -f "$R/tmp/.X99-lock" "$R/tmp/.X11-unix/X99" "$R/tmp/app.log" "$R/tmp/xvfb.log"',
    'rm -rf "$R/home/qms/.config"',
    'mkdir -p "$R/home/qms/.config"',
    '/usr/sbin/chroot "$R" /bin/bash -c ' + shellQuote(inner)
  ].join('\n');
  await writeFile(sessionScript, outer + '\n', { mode: 0o755 });
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
      this.pending.set(id, { resolve, reject });
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
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  return cdp;
}

async function waitFor(cdp, expression, label, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await cdp.evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(200);
  }
  throw new Error('timed out waiting for ' + label);
}

const clickButton = (label) => '(() => { const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === ' + JSON.stringify(label) + '); if (!button || button.disabled) return false; button.click(); return true; })()';

async function openProjectWizard(cdp, projectId) {
  await waitFor(cdp, 'document.querySelector("[data-testid=app-shell]") !== null', 'app shell', 180000);
  const card = '[data-testid="project-' + projectId + '"]';
  await waitFor(cdp, '!!document.querySelector(' + JSON.stringify(card) + ')', 'project card');
  const opened = await cdp.evaluate('(() => { const card = document.querySelector(' + JSON.stringify(card) + '); const button = [...card.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "Open"); if (!button) return false; button.click(); return true; })()');
  if (!opened) throw new Error('Open button missing');
  await waitFor(cdp, 'document.body.innerText.includes("PROJECT SETUP") && !!document.querySelector("button")', 'project setup wizard', 180000);
}

async function stepContinue(cdp, label) {
  await waitFor(cdp, clickButton('Continue'), 'Continue: ' + label);
  await sleep(400);
}

async function reachScanReview(cdp) {
  await stepContinue(cdp, 'adapter');
  await stepContinue(cdp, 'source url');
  await stepContinue(cdp, 'identity');
  await stepContinue(cdp, 'scan review');
  await waitFor(cdp, 'document.querySelector("[data-testid=scan-confirmation]") !== null', 'scan confirmation panel');
}

async function waitForScanComplete(cdp) {
  await waitFor(
    cdp,
    'document.body.innerText.includes("Quick scan complete within its request budget") || document.body.innerText.includes("Last completed quick scan")',
    'bounded scan completion',
    240000
  );
}

async function scenarioBoundedScan(cdp, server) {
  await reachScanReview(cdp);
  const afterContinue = fixtureRequestCounts(server);
  if (afterContinue.posts !== 0) throw new Error('Continue started content requests: ' + afterContinue.posts);

  const scope = await cdp.evaluate('(() => { const panel = document.querySelector("[data-testid=source-scan]"); return panel ? panel.innerText : ""; })()');
  if (!/Quick scan/.test(scope)) throw new Error('quick scan is not the offered default: ' + scope.slice(0, 400));

  await waitFor(cdp, clickButton('Confirm quick scan and continue'), 'confirm quick scan');
  await waitForScanComplete(cdp);
  const counts = fixtureRequestCounts(server);
  if (counts.posts !== 1) throw new Error('bounded scan must fetch exactly one content page, saw ' + counts.posts);
  if (Number(counts.postPerPage[0]) > 100) throw new Error('per_page is not capped: ' + counts.postPerPage[0]);
  if (!counts.categoryIncludesOnly || !counts.tagIncludesOnly) throw new Error('taxonomy was enumerated instead of included: ' + JSON.stringify(counts));
  if (!counts.mediaIncludesOnly) throw new Error('media library was enumerated instead of included: ' + JSON.stringify(counts));
  if (counts.total > 12) throw new Error('bounded scan exceeded its request budget: ' + counts.total);
  const telemetry = await cdp.evaluate('(() => { const entry = document.querySelector("[data-testid=scan-telemetry]"); return entry ? entry.innerText : null; })()');
  return { afterContinue, counts, telemetry, scopeText: scope };
}

async function scenarioPause(cdp, server) {
  await reachScanReview(cdp);
  await waitFor(cdp, clickButton('Confirm quick scan and continue'), 'confirm quick scan');
  await waitFor(cdp, '!![...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "Pause")', 'pause button', 60000);
  const clicked = await waitFor(cdp, clickButton('Pause'), 'pause click');
  if (!clicked) throw new Error('Pause was not clickable');
  await waitFor(cdp, 'document.body.innerText.toLowerCase().includes("pause")', 'pause acknowledgement', 120000);
  return { paused: true, requestsAtPause: fixtureRequestCounts(server) };
}

async function scenarioResume(cdp) {
  await openProjectWizard(cdp, scenarioResume.projectId);
  await waitFor(cdp, 'document.querySelector("[data-testid=interrupted-scan]") !== null', 'interrupted scan panel', 180000);
  await waitFor(cdp, clickButton('Resume interrupted scan from checkpoint'), 'resume click');
  await waitForScanComplete(cdp);
}

async function stopApp(child) {
  try {
    const cdp = await connectCdp();
    await Promise.race([cdp.evaluate('window.close()').catch(() => {}), sleep(2000)]);
    cdp.close();
  } catch {}
  await sleep(1500);
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 8000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  const evidence = { schema: 'qms-packaged-bounded-scan-e2e@1', startedAt: new Date().toISOString(), stages: {} };
  await rm(work, { recursive: true, force: true });
  await mkdir(dataHome, { recursive: true });
  const server = await startWordpressFixtureServer({
    data: createLargeFixtureData({ posts: 36_000, media: 250_000, categories: 2_053, tags: 50 }),
    delayMs: 900
  });
  let child = null;
  let cdp = null;
  const env = { ...process.env, ROOTFS: rootfs, APP_DIR: appDir, DATA_HOME: dataHome };
  try {
    const bounded = await seedProject(server, 'NASA bounded acceptance', 'NasaBoundedScan');
    const paused = await seedProject(server, 'NASA pause acceptance', 'NasaPauseScan');
    evidence.stages.seed = { boundedProjectId: bounded.projectId, pausedProjectId: paused.projectId, fixtureUrl: server.url };
    await writeSessionScript();

    child = spawn('unshare', ['-rmpf', 'bash', sessionScript], { detached: true, stdio: 'ignore', env });
    cdp = await connectCdp();
    await openProjectWizard(cdp, bounded.projectId);
    evidence.stages.boundedScan = await scenarioBoundedScan(cdp, server);

    server.requests.length = 0;
    await openProjectWizard(cdp, paused.projectId);
    evidence.stages.pause = await scenarioPause(cdp, server);
    const postsBefore = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/posts')).length;
    await stopApp(child);
    cdp.close();
    cdp = null;

    child = spawn('unshare', ['-rmpf', 'bash', sessionScript], { detached: true, stdio: 'ignore', env });
    cdp = await connectCdp();
    scenarioResume.projectId = paused.projectId;
    await scenarioResume(cdp);
    const postsAfter = server.requests.filter((request) => request.path.endsWith('/wp-json/wp/v2/posts')).length;
    evidence.stages.resume = { postsBefore, postsAfter, refetched: postsAfter > postsBefore, requests: fixtureRequestCounts(server) };
    if (postsAfter > postsBefore) throw new Error('resume re-fetched a completed content page');

    const state = await cdp.evaluate('({ shell: !!document.querySelector("[data-testid=app-shell]"), error: document.querySelector("[data-testid=renderer-error-screen]") !== null })');
    if (!state.shell || state.error) throw new Error('renderer showed a recovery screen');
    evidence.status = 'pass';
  } catch (error) {
    evidence.status = 'fail';
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.stages.rendererExceptions = cdp?.exceptions ?? [];
  } finally {
    if (cdp) cdp.close();
    if (child) await stopApp(child).catch(() => {});
    await server.close().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    await writeFile(outFile, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: evidence.status, out: outFile, error: evidence.error ?? null, stages: Object.keys(evidence.stages) }, null, 2));
  if (evidence.status !== 'pass') process.exit(1);
}

await main();

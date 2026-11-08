#!/usr/bin/env node
/**
 * Real packaged-Electron acceptance test for the handoff flow (BUG-002).
 *
 * Seeds a finished local project (scan, single-post plan, verified media) with
 * the real engine, then drives the *packaged* app through the UI over CDP:
 * open project -> Publishing -> Generate handoff package -> Export ZIP.
 * Asserts the window never goes blank, validates the ZIP manifest and every
 * SHA-256, restarts the app and reopens the prepared handoff.
 *
 * The GUI runs in an isolated Debian rootfs with Xvfb (no host package or
 * display changes). CDP is bound to 127.0.0.1 only for the duration of the run.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createEngine } from '../../lib/engine/index.js';
import { fixedDiskProbe } from '../../lib/engine/disk.js';
import { GIB } from '../../lib/engine/config.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { startMediaServer } from '../../test-support/media/server.js';
import { buildFolderMapFromZip, validateHandoffPackage } from '../../viewer/src/publisher/handoff.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function argument(name, fallback = null) {
  const entry = process.argv.find((value) => value.startsWith('--' + name + '='));
  return entry ? entry.slice(('--' + name + '=').length) : fallback;
}

const appDir = path.resolve(argument('app', path.join(REPO_ROOT, 'desktop/release/linux-unpacked')));
const rootfs = path.resolve(argument('rootfs', '/home/iffi/dev-workspace/tmp/qms-phase9-rootfs/trixie'));
const work = path.resolve(argument('work', '/tmp/qms-packaged-e2e'));
const dataHome = path.join(work, 'datahome');
const dataRoot = path.join(dataHome, 'qortal-migration-studio');
const outFile = path.resolve(argument('out', path.join(work, 'packaged-handoff-e2e.json')));
const sessionScript = path.join(work, 'session.sh');
const CDP_PORT = Number(argument('port', '9333'));

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedProject() {
  await rm(dataHome, { recursive: true, force: true });
  await mkdir(dataHome, { recursive: true });
  const media = await startMediaServer({});
  // Match the owner's real shape: 19 media resources totalling ~8.7 MiB in one
  // handoff (1 content + 8 index + 1 manifest + 19 media = 29 resources).
  const images = Array.from({ length: 19 }, (_, index) => {
    const bytes = 478000 + index * 1000;
    return { url: media.url + '/media/unknown?bytes=' + bytes + '&i=' + index, bytes };
  });
  const mediaBytes = images.reduce((total, entry) => total + entry.bytes, 0);
  const imageHtml = images.map((entry, index) => '<img src="' + entry.url + '" alt="Acceptance image ' + index + '">').join('');
  const data = {
    site: { name: 'Acceptance Fixture', description: 'Packaged app acceptance fixture', namespaces: ['wp/v2'] },
    posts: [
      {
        id: 101,
        slug: 'acceptance-post',
        title: 'Acceptance post',
        content: '<p>Packaged handoff acceptance body.</p>' + imageHtml,
        excerpt: '<p>Acceptance excerpt</p>',
        date: '2026-10-01T10:00:00',
        date_gmt: '2026-10-01T10:00:00',
        modified: '2026-10-02T10:00:00',
        modified_gmt: '2026-10-02T10:00:00',
        status: 'publish',
        author: 7,
        featured_media: 0,
        categories: [],
        tags: [],
        format: 'standard'
      },
      {
        id: 102,
        slug: 'second-post',
        title: 'Second post',
        content: '<p>Second body</p>',
        excerpt: '',
        date: '2026-09-01T10:00:00',
        date_gmt: '2026-09-01T10:00:00',
        modified: '2026-09-02T10:00:00',
        modified_gmt: '2026-09-02T10:00:00',
        status: 'publish',
        author: 7,
        featured_media: 0,
        categories: [],
        tags: []
      }
    ],
    pages: [],
    categories: [],
    tags: [],
    media: []
  };
  const wp = await startWordpressFixtureServer({ data });
  const engine = createEngine({ dataRoot, diskProbe: fixedDiskProbe(10 * GIB) });
  let handle = null;
  try {
    const project = await engine.projects.create({
      name: 'AstuAeda acceptance',
      source: { adapter: 'wordpress', baseUrl: wp.url },
      target: { qdnName: 'AcceptanceName', siteName: 'AstuAeda acceptance' },
      settings: {
        disk: { reserveBytes: 0, maxBytesPerRun: 0 },
        media: { allowLoopback: true, allowExternalMedia: false, maxRetries: 0, retryDelayMs: 0 }
      }
    });
    handle = await engine.projects.open(project.id);
    const discovered = await handle.source.discover({ perPage: 100 });
    if (discovered.status !== 'completed') throw new Error('fixture discovery failed');
    const planResult = await handle.planning.create({ batchSize: 1, estimateMedia: true, persist: true });
    if (planResult.status !== 'completed') throw new Error('fixture plan failed: ' + JSON.stringify(planResult.plan?.errors ?? planResult.error));
    const planId = planResult.planId;
    const download = await handle.media.download({ planId, concurrency: 2 });
    if (!['completed', 'partial'].includes(download.status)) throw new Error('fixture media download failed: ' + download.status);
    const plan = await handle.planning.get(planId);
    return {
      projectId: project.id,
      planId,
      selectedCount: plan.plan.stats.selected,
      mediaCount: plan.plan.mediaSummary.count,
      expectedMediaBytes: mediaBytes,
      mediaDownloadStatus: download.status,
      mediaDownloadedBytes: download.counts?.downloadedBytes ?? download.downloadedBytes ?? null,
      siteId: project.siteId
    };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await engine.close().catch(() => {});
    await wp.close().catch(() => {});
    await media.close().catch(() => {});
  }
}

async function writeSessionScript() {
  const lines = [
    '#!/bin/bash',
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
    'export QMS_CDP_PORT=' + CDP_PORT,
    'rm -f "$R/tmp/.X99-lock" "$R/tmp/.X11-unix/X99" "$R/tmp/app.log" "$R/tmp/xvfb.log"',
    'rm -rf "$R/home/qms/.config"',
    'mkdir -p "$R/home/qms/.config"',
    '/usr/sbin/chroot "$R" /bin/bash -c \'',
    'set -e',
    'export HOME=/home/qms',
    'export XDG_DATA_HOME=/mnt/datahome',
    'export XDG_CONFIG_HOME=/home/qms/.config',
    'export DISPLAY=:99',
    'export ELECTRON_DISABLE_SECURITY_WARNINGS=1',
    'Xvfb :99 -screen 0 1366x900x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &',
    'XVFB=$!',
    'for i in $(seq 1 60); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.2; done',
    '[ -S /tmp/.X11-unix/X99 ] || { echo XVFB_FAILED; cat /tmp/xvfb.log; exit 1; }',
    'exec /opt/qms-e2e/app/qortal-migration-studio --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=$QMS_CDP_PORT --remote-allow-origins=*',
    "\'"
  ];
  await writeFile(sessionScript, lines.join('\n') + '\n', { mode: 0o755 });
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
  close() {
    try { this.ws.close(); } catch {}
  }
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
    await sleep(250);
  }
  throw new Error('timed out waiting for ' + label);
}

const clickButton = (label) => `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`;
const clickButtonStartsWith = (label) => `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.trim().startsWith(${JSON.stringify(label)})); if (!button) return false; button.click(); return true; })()`;

async function newestZip(dir) {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.name.endsWith('.zip')) found.push(absolute);
    }
  };
  await walk(dir);
  const stats = await Promise.all(found.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })));
  stats.sort((left, right) => right.mtime - left.mtime);
  return stats[0]?.file ?? null;
}

async function verifyZip(zipPath) {
  const buffer = await readFile(zipPath);
  const entries = unzipSync(new Uint8Array(buffer));
  const manifestEntry = entries['handoff.json'];
  if (!manifestEntry) throw new Error('handoff.json missing from ZIP root');
  const manifest = JSON.parse(Buffer.from(manifestEntry).toString('utf8'));
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) throw new Error('manifest has no resources');
  let verified = 0;
  let mediaBytes = 0;
  for (const resource of manifest.resources) {
    const payload = entries[resource.relativePath];
    if (!payload) throw new Error('missing payload ' + resource.relativePath);
    const bytes = Buffer.from(payload);
    if (bytes.length !== resource.bytes) throw new Error('byte mismatch for ' + resource.relativePath);
    const expected = String(resource.sha256 ?? '').replace(/^sha256:/, '');
    if (sha256(bytes) !== expected) throw new Error('sha256 mismatch for ' + resource.relativePath);
    if (resource.kind === 'media') mediaBytes += bytes.length;
    verified += 1;
  }
  // Run the released Migration Publisher (0.8.0-alpha.2) validation code on the
  // exported ZIP. This proves field/schema compatibility without a live QDN
  // publish; the Publisher's own validator checks the manifest, hashes, bundle
  // metadata and resource ordering.
  const publisher = await validateHandoffPackage(await buildFolderMapFromZip(new File([buffer], 'handoff.zip')));
  return {
    publisherCompatible: true,
    publisherResources: publisher.manifest.resources.length,
    publisherSummaryResources: publisher.summary.resources ?? null,
    zipBytes: buffer.length,
    zipSha256: sha256(buffer),
    resources: manifest.resources.length,
    verified,
    mediaBytes,
    mediaResources: manifest.resources.filter((resource) => resource.kind === 'media').length,
    service: manifest.resources.find((resource) => resource.kind === 'site')?.service ?? null,
    target: manifest.target?.qdnName ?? null,
    handoffId: manifest.handoffId
  };
}

async function openPublishing(cdp, projectId) {
  await waitFor(cdp, "document.querySelector('[data-testid=app-shell]') !== null", 'app shell', 120000);
  await waitFor(cdp, "!!document.querySelector('[data-testid=\"project-" + projectId + "\"]')", 'project card');
  const opened = await cdp.evaluate("(() => { const card = document.querySelector('[data-testid=\"project-" + projectId + "\"]'); const button = [...card.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Open'); if (!button) return false; button.click(); return true; })()");
  if (!opened) throw new Error('Open button missing');
  // A project without a completed wizard opens in setup; the header Publishing
  // entry is the same navigation a real user takes.
  await waitFor(cdp, clickButton('Publishing'), 'Publishing navigation');
  await waitFor(cdp, "document.querySelector('[data-testid=publishing-view]') !== null", 'publishing view');
}

function assertNotBlank(state) {
  if (!state.shell || state.error) throw new Error('renderer showed a recovery screen or lost the app shell');
}

async function generateHandoff(cdp) {
  await waitFor(cdp, "document.body.innerText.includes('resources selected')", 'plan selection');
  await waitFor(cdp, "!![...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Generate handoff package' && !entry.disabled)", 'generate button enabled');
  const clicked = await cdp.evaluate(clickButton('Generate handoff package'));
  if (!clicked) throw new Error('Generate handoff package button not clickable');
  // 29 rows including 19 media resources: the exact shape that blanked the
  // renderer when status was missing.
  await waitFor(cdp, "document.body.innerText.includes('Handoff ready') || document.body.innerText.includes('Portable handoff is ready') || document.body.innerText.includes('Handoff package created')", 'handoff ready', 240000);
  const state = await cdp.evaluate("({ text: document.body.innerText, shell: !!document.querySelector('[data-testid=app-shell]'), error: document.querySelector('[data-testid=renderer-error-screen]') !== null, rows: document.querySelectorAll('tbody tr').length })");
  assertNotBlank(state);
  return state;
}

async function exportPrepared(cdp) {
  await waitFor(cdp, "!![...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Export Publisher package (.zip)' && !entry.disabled)", 'export button');
  await cdp.evaluate(clickButton('Export Publisher package (.zip)'));
  await waitFor(cdp, "document.body.innerText.includes('Publisher package exported')", 'export confirmation', 180000);
  const state = await cdp.evaluate("({ text: document.body.innerText, shell: !!document.querySelector('[data-testid=app-shell]'), error: document.querySelector('[data-testid=renderer-error-screen]') !== null })");
  assertNotBlank(state);
  return state;
}

/**
 * Recovery path for an existing handoff directory without a ZIP: select the
 * handoff and click "Package existing handoff (.zip)". This calls exportBundle
 * only; it must not call publication.prepare or duplicate resources.
 */
async function packageExisting(cdp) {
  await waitFor(cdp, "!!document.querySelector('[data-testid=package-existing-handoff]:not([disabled])')", 'package-existing button', 120000);
  const clicked = await cdp.evaluate("(() => { const button = document.querySelector('[data-testid=package-existing-handoff]'); if (!button || button.disabled) return false; button.click(); return true; })()");
  if (!clicked) throw new Error('package-existing button not clickable');
  await waitFor(cdp, "document.body.innerText.includes('Publisher package exported')", 'package-existing confirmation', 180000);
  const state = await cdp.evaluate("({ text: document.body.innerText, shell: !!document.querySelector('[data-testid=app-shell]'), error: document.querySelector('[data-testid=renderer-error-screen]') !== null })");
  assertNotBlank(state);
  return state;
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

async function handoffSnapshot(projectId) {
  const root = path.join(dataRoot, 'projects', projectId, 'publication', 'handoffs');
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length !== 1) throw new Error('expected exactly one handoff directory, found ' + dirs.length);
  const dir = path.join(root, dirs[0]);
  const manifest = JSON.parse(await readFile(path.join(dir, 'handoff.json'), 'utf8'));
  let verified = 0;
  let mediaBytes = 0;
  for (const resource of manifest.resources) {
    const bytes = await readFile(path.join(dir, resource.relativePath));
    const expected = String(resource.sha256 ?? '').replace(/^sha256:/, '');
    if (bytes.length !== resource.bytes) throw new Error('handoff byte mismatch: ' + resource.relativePath);
    if (sha256(bytes) !== expected) throw new Error('handoff hash mismatch: ' + resource.relativePath);
    if (resource.kind === 'media') mediaBytes += bytes.length;
    verified += 1;
  }
  const zips = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.name.endsWith('.zip')) zips.push(absolute);
    }
  };
  await walk(dir);
  return {
    handoffDir: dir,
    handoffId: manifest.handoffId,
    schema: manifest.schema,
    resources: manifest.resources.length,
    verified,
    mediaBytes,
    zipFilesInsideHandoffDir: zips.length,
    readmePresent: (await readdir(dir)).includes('README.txt')
  };
}

async function main() {
  const evidence = { schema: 'qms-packaged-handoff-e2e@1', startedAt: new Date().toISOString(), stages: {} };
  await mkdir(work, { recursive: true });
  evidence.stages.seed = await seedProject();
  await writeSessionScript();

  const env = { ...process.env, ROOTFS: rootfs, APP_DIR: appDir, DATA_HOME: dataHome, CDP_PORT: String(CDP_PORT) };
  let child = spawn('unshare', ['-rmpf', 'bash', sessionScript], { detached: true, stdio: 'ignore', env });
  let cdp = null;
  try {
    cdp = await connectCdp();
    await openPublishing(cdp, evidence.stages.seed.projectId);
    evidence.stages.firstRun = await generateHandoff(cdp);
    evidence.stages.handoffDir = await handoffSnapshot(evidence.stages.seed.projectId);
    if (evidence.stages.handoffDir.resources !== 29) {
      throw new Error('expected 29 handoff resources, found ' + evidence.stages.handoffDir.resources);
    }
    if (evidence.stages.handoffDir.zipFilesInsideHandoffDir !== 0) {
      throw new Error('handoff directory unexpectedly contains a ZIP');
    }
    await exportPrepared(cdp);
    const firstZip = await newestZip(dataRoot);
    if (!firstZip) throw new Error('no exported ZIP found after export');
    evidence.stages.firstZip = { path: firstZip, ...(await verifyZip(firstZip)) };
    if (evidence.stages.firstZip.resources !== 29) throw new Error('exported ZIP does not contain 29 resources');
    if (evidence.stages.firstZip.mediaBytes < 8.5 * 1024 * 1024) throw new Error('exported media bytes are implausibly small');

    // Simulate the owner's state: the handoff directory is complete but the
    // ZIP is gone. A restart must package it without regenerating anything.
    await rm(path.join(dataRoot, 'exports'), { recursive: true, force: true });
    evidence.stages.recovery = { zipRemoved: true, handoffDirKept: true };

    await stopApp(child);
    cdp.close();
    cdp = null;

    child = spawn('unshare', ['-rmpf', 'bash', sessionScript], { detached: true, stdio: 'ignore', env });
    cdp = await connectCdp();
    await openPublishing(cdp, evidence.stages.seed.projectId);
    evidence.stages.restart = await packageExisting(cdp);
    const recreated = await newestZip(dataRoot);
    if (!recreated) throw new Error('package-existing did not produce a ZIP');
    const after = await handoffSnapshot(evidence.stages.seed.projectId);
    evidence.stages.restartZip = {
      path: recreated,
      handoffDirsAfterRecovery: 1,
      handoffIdUnchanged: after.handoffId === evidence.stages.handoffDir.handoffId,
      ...(await verifyZip(recreated))
    };
    if (!evidence.stages.restartZip.handoffIdUnchanged) throw new Error('recovery changed the handoff identity');
    if (evidence.stages.restartZip.zipSha256 !== evidence.stages.firstZip.zipSha256) {
      throw new Error('recovery produced different ZIP bytes');
    }
    evidence.status = 'pass';
  } catch (error) {
    evidence.status = 'fail';
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.stages.rendererExceptions = cdp?.exceptions ?? [];
  } finally {
    if (cdp) cdp.close();
    if (child) await stopApp(child);
    await copyFile(path.join(rootfs, 'tmp/app.log'), path.join(work, 'app.log')).catch(() => {});
    await copyFile(path.join(rootfs, 'tmp/xvfb.log'), path.join(work, 'xvfb.log')).catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    await writeFile(outFile, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: evidence.status, out: outFile, error: evidence.error ?? null, stages: Object.keys(evidence.stages) }, null, 2));
  if (evidence.status !== 'pass') process.exit(1);
}

await main();

#!/usr/bin/env node
// Drives the actual packaged renderer, preload, main process and engine.
// Uses isolated X11 over loopback for restricted CI runners; normal desktop
// launches keep Electron sandboxing and the single-instance lock enabled.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { receiptFor } from '../../test/phase7/support.js';
const arg = (name, fallback) => process.argv.find((entry) => entry.startsWith('--' + name + '='))?.split('=').slice(1).join('=') ?? fallback;
const repo = path.resolve(import.meta.dirname, '../..');
const app = path.resolve(arg('app', path.join(repo, 'desktop/release/linux-unpacked')));
const work = path.resolve(arg('work', path.join(repo, 'desktop/release/guided-acceptance')));
const guiRoot = arg('gui-root', '');
const display = 130 + Math.floor(Math.random() * 50);
const port = 9400 + Math.floor(Math.random() * 100);
await mkdir(work, { recursive: true });
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'pass' : 'fail', detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); };
const env = { ...process.env, DISPLAY: '127.0.0.1:' + display, XDG_DATA_HOME: path.join(work, 'data'), XDG_CONFIG_HOME: path.join(work, 'config'), QMS_ISOLATED_TEST: '1' };
let xvfb, child, cdp, fixture, qdn;
let log = '';
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.sequence = 0; this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', (event) => { const message = JSON.parse(String(event.data)); const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); } });
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.sequence; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
}
async function waitFor(expression, timeout = 60000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await cdp.evaluate(expression)) return; await sleep(100); } throw new Error('Timed out: ' + expression + '\n' + await cdp.evaluate('document.body?.innerText')); }
async function click(text) { const result = await cdp.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)return false;button.click();return true;})()`); check('Click: ' + text, result); await sleep(80); }
async function fill(label, value) { const result = await cdp.evaluate(`(()=>{const field=[...document.querySelectorAll('label.field')].find(e=>e.querySelector('.field-label')?.textContent===${JSON.stringify(label)});const input=field?.querySelector('input,textarea,select');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`); check('Fill: ' + label, result); await sleep(80); }
try {
  if (guiRoot) {
    const root = path.resolve(guiRoot);
    const xenv = { ...env, LD_LIBRARY_PATH: path.join(root, 'usr/lib/x86_64-linux-gnu'), XKB_BINDIR: path.join(root, 'usr/bin') };
    xvfb = spawn(path.join(root, 'usr/bin/Xvfb'), [':' + display, '-screen', '0', '1280x900x24', '-nolisten', 'unix', '-nolisten', 'local', '-listen', 'tcp', '-ac', '-xkbdir', path.join(root, 'usr/share/X11/xkb')], { env: xenv, stdio: ['ignore', 'pipe', 'pipe'] });
    xvfb.stderr.on('data', (chunk) => { log += 'X11 ' + chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      const ok = await new Promise((resolve) => { const socket = net.connect(6000 + display, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
      if (ok) break; await sleep(50);
    }
  }
  fixture = await startWordpressFixtureServer({ data: dataWithPosts([makePost(1), makePost(2), makePost(3)]) });
  qdn = await startQdnServer();
  child = spawn(path.join(app, 'qortal-migration-studio'), ['--qms-isolated-test', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { log += chunk; }); child.stderr.on('data', (chunk) => { log += chunk; });
  let target;
  for (let attempt = 0; attempt < 150; attempt++) { try { target = (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).find((entry) => entry.type === 'page'); if (target) break; } catch {} await sleep(100); }
  if (!target) throw new Error('Packaged application did not open.\n' + log);
  cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.ready;
  await waitFor("document.querySelector('[data-testid=\"app-shell\"]') && document.body?.innerText.includes('Your websites')");
  check('Guided mode opens by default', await cdp.evaluate("document.body?.innerText.includes('Bring your content to Qortal')"));
  await click('Add a website');
  await fill('WordPress website address', fixture.url);
  await click('Connect and continue');
  await waitFor("document.body?.innerText.includes('Choose what to bring over')");
  await click('Continue');
  await fill('Your registered Qortal name', 'GuidedFixture');
  await click('Check selected content');
  await waitFor("document.body?.innerText.includes('Ready to review')");
  const project = await cdp.evaluate('(async()=> (await window.qms.projects.list(false))[0])()');
  let state = await cdp.evaluate(`window.qms.workflow(${JSON.stringify(project.id)},'status')`);
  check('Real IPC scan selects all three fixture posts', state.total === 3, { total: state.total, status: state.status });
  await click('Prepare for Qortal');
  await waitFor("document.body?.innerText.includes('Your publication package is ready')");
  state = await cdp.evaluate(`window.qms.workflow(${JSON.stringify(project.id)},'status')`);
  check('Local chain produces a portable package', state.status === 'ready' && state.bundle.bytes > 0, { status: state.status, bytes: state.bundle?.bytes });
  const detail = await cdp.evaluate(`window.qms.publication.get(${JSON.stringify(project.id)},${JSON.stringify(state.handoffId)})`);
  const manifest = JSON.parse(await readFile(path.join(detail.absolutePath, 'handoff.json'), 'utf8'));
  for (const resource of manifest.resources) qdn.set({ service: resource.service, name: resource.name, identifier: resource.identifier, bytes: await readFile(path.join(detail.absolutePath, resource.relativePath)), contentType: resource.contentType });
  await click('Settings & help'); await fill('Qortal node address', qdn.url);
  const receiptFile = path.join(work, 'publisher-receipt.json'); await writeFile(receiptFile, JSON.stringify(receiptFor(manifest, 'guidede2e')));
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [receiptFile] });
  await waitFor("document.body?.innerText.includes('Your website is verified on Qortal')");
  state = await cdp.evaluate(`window.qms.workflow(${JSON.stringify(project.id)},'status')`);
  check('File import triggers independent verification', state.status === 'published' && state.verification.resources.every((resource) => resource.status === 'remote_verified'));
  await click('Settings & help');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 720, deviceScaleFactor: 1, mobile: false });
  const noOverflow = await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth');
  check('Small desktop has no horizontal overflow', noOverflow);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(work, 'guided-published.png'), Buffer.from(screenshot.data, 'base64'));
  check('No unhandled UI error', !await cdp.evaluate("document.body?.innerText.includes('Something went wrong')"));
  await cdp.evaluate('location.reload()');
  await waitFor("document.body?.innerText.includes('Your websites')");
  await click('Continue this website');
  await waitFor("document.body?.innerText.includes('Your website is verified on Qortal')");
  check('Reopen reconstructs the verified workflow', true);
  await click('Advanced tools'); await waitFor("document.body?.innerText.includes('Your migration projects')");
  check('Advanced tools remain available', true);
  await writeFile(path.join(work, 'result.json'), JSON.stringify({ schema: 'qms-guided-acceptance@1', status: 'pass', checks, app, isolatedSingleInstance: true, sandboxDisabledForRunner: true }, null, 2));
  console.log(JSON.stringify({ status: 'pass', checks: checks.length, output: path.join(work, 'result.json') }));
} catch (error) {
  await writeFile(path.join(work, 'result.json'), JSON.stringify({ schema: 'qms-guided-acceptance@1', status: 'fail', checks, error: error.message, log: log.slice(-8000) }, null, 2));
  console.error(error.stack); process.exitCode = 1;
} finally {
  cdp?.ws.close(); child?.kill('SIGTERM'); xvfb?.kill('SIGTERM');
  await fixture?.close(); await qdn?.close(); await writeFile(path.join(work, 'app.log'), log);
}

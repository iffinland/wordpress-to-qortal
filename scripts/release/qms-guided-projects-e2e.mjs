#!/usr/bin/env node
// Local packaged Desktop acceptance. All source/QDN traffic uses fixture servers;
// this script never signs, publishes or spends QORT.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { makePost, dataWithPosts } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { populateQdn, receiptFor } from '../../test/phase7/support.js';
const root = path.resolve(import.meta.dirname, '../..');
const option = (key, fallback) => process.argv.find(x => x.startsWith('--' + key + '='))?.split('=').slice(1).join('=') ?? fallback;
const work = path.resolve(option('work', '/tmp/qms-guided-acceptance-' + Date.now()));
const app = path.resolve(option('app', path.join(root, 'desktop/release/linux-unpacked/qortal-migration-studio')));
const config = path.join(work, 'xorg.conf'); const port = 9453; const display = 120 + Math.floor(Math.random() * 200);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { schema: 'qms-guided-projects-acceptance@1', app, startedAt: new Date().toISOString(), checks: [] };
await mkdir(work, { recursive: true });
const authMode = option('auth', 'none');
const wp = await startWordpressFixtureServer({ data: dataWithPosts([makePost(1), makePost(2), makePost(3)]), requireAuth: authMode !== 'none', authMode: authMode === 'application_password' ? 'application_password' : 'session', requireRestNonce: ['session', 'browser'].includes(authMode), loginCaptcha: authMode === 'browser', loginCaptchaReference: authMode === 'session' });
evidence.authMode = authMode;
const qdn = await startQdnServer();
let xorg, electron, cdp;
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.sequence = 0;
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', event => { const result = JSON.parse(String(event.data)); const pending = this.pending.get(result.id); if (pending) { this.pending.delete(result.id); result.error ? pending.reject(new Error(JSON.stringify(result.error))) : pending.resolve(result.result); } });
  }
  async send(method, params = {}) { await this.ready; const id = ++this.sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000); this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
}
async function until(expression, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await cdp.evaluate(expression)) return; await pause(120); }
  throw new Error('Timed out: ' + description + '\n' + await cdp.evaluate('document.body.innerText.slice(-3500)'));
}
async function click(text) { await until(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`, 'button ' + text); await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled).click()`); }
async function field(label, value) { await until(`Array.from(document.querySelectorAll('label .field-label')).some(l=>l.textContent.trim()===${JSON.stringify(label)})`, 'field ' + label); await cdp.evaluate(`(() => { const label = Array.from(document.querySelectorAll('label')).find(l => l.querySelector('.field-label')?.textContent.trim() === ${JSON.stringify(label)}); const input=label?.querySelector('input,textarea,select'); if (!input) throw new Error('Missing field '+${JSON.stringify(label)}); const prototype=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`); }
async function checkLabel(text) { await cdp.evaluate(`(() => { const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(text)})); if (!label) throw new Error('Missing checkbox'); const input=label.querySelector('input[type=checkbox]'); if (!input.checked) input.click(); })()`); }
async function record(name) { evidence.checks.push({ name, passed: true }); console.log('PASS ' + name); }
async function connectWebsite() {
  if (authMode === 'none') { await click('Connect and continue'); return; }
  await field('WordPress access method', authMode === 'browser' ? 'session' : authMode);
  if (authMode !== 'browser') {
    assert.equal(await cdp.evaluate("document.querySelector('details')?.open ?? false"), false, 'Website login help stays collapsed in the normal flow');
    await field('WordPress username or email', 'fixture-user');
    await field(authMode === 'session' ? 'Website login password' : 'WordPress application password', authMode === 'session' ? 'fixture-password' : 'fixture-app-password');
    const screenshot = await cdp.send('Page.captureScreenshot'); await writeFile(path.join(work, 'login-form.png'), Buffer.from(screenshot.data, 'base64'));
    await click('Connect and continue'); return;
  }
  await cdp.evaluate("Array.from(document.querySelectorAll('summary')).find(item=>item.textContent.trim()==='Trouble signing in?').click()");
  await click('Open WordPress login window');
  let login;
  for (let i = 0; i < 100; i++) {
    const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json());
    const target = targets.find(entry => entry.type === 'page' && entry.url.startsWith(wp.url));
    if (target) { login = new Cdp(target.webSocketDebuggerUrl); break; }
    await pause(100);
  }
  assert.ok(login, 'Isolated WordPress login window opened'); await login.ready;
  // Fixture-only challenge. This never solves or bypasses a real website CAPTCHA.
  await login.evaluate(`(() => { document.querySelector('input[name=log]').value='fixture-user'; document.querySelector('input[name=pwd]').value='fixture-password'; document.querySelector('input[type=checkbox]').click(); document.querySelector('form').requestSubmit(); })()`);
  let signedIn = false;
  for (let i = 0; i < 100; i++) { try { signedIn = await login.evaluate("document.body.innerText.includes('Signed in to fixture site')"); if (signedIn) break; } catch {} await pause(100); }
  assert.ok(signedIn, 'User completed fixture sign-in'); login.socket.close();
  await click('Use signed-in session');
}
async function approveAndPrepare() {
  await until("document.body.innerText.includes('Review your selection') || document.body.innerText.includes('Review new, changed')", 'selection review');
  await click('Check publishing address'); await until("document.body.innerText.includes('Confirm publishing address')", 'destination review');
  await checkLabel(await cdp.evaluate("document.body.innerText.includes('I understand that this package may replace')") ? 'I understand that this package may replace' : 'This is the publishing address'); await click('Confirm publishing address'); await click('Prepare for Qortal');
  await until("document.body.innerText.includes('Your publication package is ready')", 'publication package');
}
let id, dataRoot;
async function verifyPackage(suffix) {
  const state = await cdp.evaluate(`window.qms.workflow(${JSON.stringify(id)},'status')`); assert.equal(state.status, 'ready');
  const list = await cdp.evaluate(`window.qms.publication.list(${JSON.stringify(id)})`); const handoff = list.find(entry => entry.handoffId === state.handoffId);
  assert.ok((await readFile(state.bundle.absolutePath)).length > 0);
  const manifest = await populateQdn(qdn, { engine: { projects: { paths: () => ({ root: path.join(dataRoot, 'projects', id) }) } }, project: { id } }, handoff);
  const file = path.join(work, 'receipt-' + suffix + '.json'); await writeFile(file, JSON.stringify(receiptFor(manifest, suffix)));
  await click('Settings & help'); await field('Qortal node address', qdn.url); await click('Settings & help');
  const doc = await cdp.send('DOM.getDocument'); const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] });
  await until("document.body.innerText.includes('Your website is verified on Qortal')", 'independent publication verification', 90000);
  return manifest;
}
try {
  await writeFile(config, 'Section "ServerFlags"\n Option "AutoAddDevices" "false"\nEndSection\nSection "Device"\n Identifier "Dummy"\n Driver "dummy"\n VideoRam 256000\nEndSection\nSection "Screen"\n Identifier "Screen"\n Device "Dummy"\n DefaultDepth 24\n SubSection "Display"\n Depth 24\n Virtual 1280 900\n EndSubSection\nEndSection\n');
  xorg = spawn('/usr/lib/xorg/Xorg', [':' + display, '-config', config, '-logfile', path.join(work, 'xorg.log'), '-noreset', '-nolisten', 'unix', '-nolisten', 'local', '-listen', 'tcp', '-ac'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { const ready = await new Promise(resolve => { const socket = net.connect(6000 + display, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); }); if (ready) break; await pause(100); }
  electron = spawn(app, ['--qms-isolated-test', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { env: { ...process.env, DISPLAY: '127.0.0.1:' + display, XDG_DATA_HOME: path.join(work, 'data'), XDG_CONFIG_HOME: path.join(work, 'config'), QMS_ISOLATED_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; electron.on('error', error => { logs += error.message; }); electron.stderr.on('data', chunk => { logs = (logs + chunk).slice(-20000); });
  for (let i = 0; i < 150; i++) { try { const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()); const page = targets.find(item => item.type === 'page'); if (page) { cdp = new Cdp(page.webSocketDebuggerUrl); break; } } catch {} if (electron.exitCode !== null) throw new Error(logs); await pause(100); }
  assert.ok(cdp, 'Electron CDP startup: ' + logs); await cdp.ready;
  await click('Add a website'); await field('Local project name', 'Guided acceptance archive'); await field('WordPress website address', wp.url); await connectWebsite();
  await until("document.body.innerText.includes('Number of recent items')", 'content choice'); await field('Number of recent items', '1'); await click('Continue'); await field('Your registered Qortal name', 'GuidedAcceptance'); await click('Check selected content');
  const projects = await cdp.evaluate('window.qms.projects.list(true)'); id = projects[0].id; dataRoot = (await cdp.evaluate('window.qms.app.settings()')).dataRoot;
  await approveAndPrepare(); const first = await verifyPackage('first'); await record('Fresh project: connection, sample, ZIP, receipt and exact APP/content verification');
  await click('Add older articles'); await field('From date (UTC)', '2024-01-01'); await field('Through date (UTC)', '2024-12-31'); await click('Continue'); await click('Check selected content'); await approveAndPrepare(); await verifyPackage('archive');
  const mapping = await cdp.evaluate(`window.qms.identity.get(${JSON.stringify(id)})`); assert.equal(mapping.mappings.filter(x => x.contentType === 'post').length, 3); await record('Older date-range content extends the same three-item catalog without duplicate identities');
  const sourceKey = first.resources.find(item => item.kind === 'content').sourceKey; const post = wp.data.posts.find(item => 'post:' + item.id === sourceKey); post.content = '<p>Edited after the first migration</p>'; post.modified = post.modified_gmt = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  await click('Bring new and changed content'); await click('Continue'); await click('Check selected content'); await approveAndPrepare(); await verifyPackage('update');
  assert.equal((await cdp.evaluate(`window.qms.identity.get(${JSON.stringify(id)})`)).mappings.filter(x => x.contentType === 'post').length, 3); await record('Guided updates revise the original article and preserve the earlier catalog');
  await click('Project settings'); await field('Local project name', 'Renamed acceptance archive'); await click('Save local name'); await until("document.body.innerText.includes('Local project name saved')", 'project rename'); await click('Back to project'); await click('Your websites');
  await until("Array.from(document.querySelectorAll('.project-card button')).some(b=>b.textContent.trim()==='Archive')", 'active project card');
  await cdp.evaluate("Array.from(document.querySelectorAll('.project-card button')).find(b=>b.textContent.trim()==='Archive').click()"); await until("document.body.innerText.includes('Project archived.')", 'archive result'); await click('Archive'); await click('Restore to active projects'); await click('Remove from this computer'); await click('Move to Deleted projects'); await click('Deleted projects'); await click('Restore project');
  await until(`window.qms.projects.list(true).then(list=>list.some(entry=>entry.id===${JSON.stringify(id)}))`, 'restored project on disk');
  assert.equal((await cdp.evaluate('window.qms.projects.list(true)'))[0].id, id); await record('Rename, archive, reactivate, remove and restore preserve the original project');
  const screenshot = await cdp.send('Page.captureScreenshot'); await writeFile(path.join(work, 'project-center.png'), Buffer.from(screenshot.data, 'base64'));
  await click('Add a website'); await field('Local project name', 'Independent copy'); await field('WordPress website address', wp.url); await checkLabel('Create an independent project'); await connectWebsite(); await click('Continue'); await field('Your registered Qortal name', 'GuidedAcceptance'); await click('Check selected content'); await click('Check publishing address'); await until("document.body.innerText.includes('Other local projects at this address')", 'conflicting destination');
  const separate = await cdp.evaluate('window.qms.projects.list(true)'); assert.equal(separate.length, 2); assert.notEqual(separate[0].siteId, separate[1].siteId); await record('Independent same-source project is allowed and shared Qortal address is explicitly reviewed');
  // A wrong destination remains correctable before any Hub submission.
  await checkLabel(await cdp.evaluate("document.body.innerText.includes('I understand that this package may replace')") ? 'I understand that this package may replace' : 'This is the publishing address');
  await click('Confirm publishing address'); await click('Prepare for Qortal');
  await until("document.body.innerText.includes('Your publication package is ready')", 'independent package');
  await cdp.evaluate("Array.from(document.querySelectorAll('summary')).find(s=>s.textContent.includes('I need to change a package')).click()");
  await checkLabel('I have never submitted this package'); await click('Set aside unsubmitted package');
  await until("document.querySelector('h1')?.textContent.includes('Ready to set up')", 'discarded package');
  await click('Project settings'); await field('Qortal publishing name', 'CorrectedAcceptance'); await click('Save website settings');
  await until("document.body.innerText.includes('Publishing destination changes')", 'migration preview');
  await checkLabel('I want to prepare this site'); await click('Confirm and save new destination');
  await until("document.body.innerText.includes('Project settings saved')", 'saved migrated destination');
  assert.equal((await cdp.evaluate('window.qms.projects.list(true)')).find(entry => entry.name === 'Independent copy').targetQdnName, 'CorrectedAcceptance');
  await record('Never-submitted package can be set aside and its existing identities migrated to a corrected Qortal name');
  await click('Projects / Home'); await until("document.querySelector('h1')?.textContent.includes('Your projects')", 'persistent project Home action');
  const persisted = await readFile(path.join(dataRoot, 'projects', id, 'project.json'), 'utf8');
  for (const secret of ['fixture-password', 'fixture-app-password', 'browserSession', 'fixture-rest-nonce']) assert.ok(!persisted.includes(secret), 'Project files do not store ' + secret);
  await record('Persistent Home navigation and credential-free project persistence');
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = error.stack; console.error(error.stack); if (cdp) { const screenshot = await cdp.send('Page.captureScreenshot').catch(() => null); if (screenshot) await writeFile(path.join(work, 'failure.png'), Buffer.from(screenshot.data, 'base64')); } process.exitCode = 1; }
finally {
  evidence.completedAt = new Date().toISOString(); await writeFile(path.join(work, 'acceptance.json'), JSON.stringify(evidence, null, 2));
  if (cdp) cdp.socket.close(); if (electron) { electron.kill('SIGTERM'); await new Promise(resolve => { electron.once('exit', resolve); setTimeout(resolve, 3000); }); if (electron.exitCode === null) electron.kill('SIGKILL'); } xorg?.kill('SIGTERM'); await wp.close(); await qdn.close();
  console.log('Evidence: ' + path.join(work, 'acceptance.json'));
}

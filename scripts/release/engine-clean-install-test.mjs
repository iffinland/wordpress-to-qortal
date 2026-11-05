#!/usr/bin/env node
/**
 * Clean-install proof for the packaged engine.
 *
 * Extracts the built .deb with dpkg-deb -x into a temporary root and executes
 * the engine exactly as the desktop main process does: the packaged
 * bin/qms-host.js over stdio JSON-RPC with QMS_DATA_ROOT and QMS_REPO_ROOT set,
 * from a directory with no ancestor node_modules. It then performs a real
 * engine.info handshake and asserts the JSON-RPC response.
 *
 * --hide-node-module=<name> removes one package from the extracted copy only.
 * Combined with --expect-failure this is the regression proof that a .deb with
 * an incomplete runtime dependency tree cannot pass the gate.
 *
 * Usage:
 *   node scripts/release/engine-clean-install-test.mjs
 *   node scripts/release/engine-clean-install-test.mjs --artifact=<deb> --out=<json>
 *   node scripts/release/engine-clean-install-test.mjs --hide-node-module=fflate --expect-failure
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT, artifactName, readJson, sha256File } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const rawArgs = process.argv.slice(2);
const args = Object.fromEntries(rawArgs.map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const hiddenModules = rawArgs
  .filter((value) => value.startsWith('--hide-node-module='))
  .map((value) => value.slice('--hide-node-module='.length));
const expectFailure = args['expect-failure'] === true;
const keep = args.keep === true;
const runtime = String(args.runtime ?? 'node');
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const version = componentVersion(release, 'desktop');
const artifact = path.resolve(args.artifact ?? path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, version, release.architecture)));
const out = path.resolve(args.out ?? path.join(REPO_ROOT, 'desktop/release', expectFailure ? 'engine-clean-install-negative.json' : 'engine-clean-install.json'));

try {
  await stat(artifact);
} catch {
  console.error('engine clean-install test: artifact not found: ' + artifact);
  process.exit(2);
}
if (runtime !== 'node' && runtime !== 'electron') {
  console.error('engine clean-install test: --runtime must be node or electron');
  process.exit(2);
}

const artifactSha = await sha256File(artifact);
const artifactBytes = (await stat(artifact)).size;
const workRoot = await mkdtemp(path.join(tmpdir(), 'qms-engine-clean-'));
const extractRoot = path.join(workRoot, 'root');
const dataRoot = path.join(workRoot, 'data');
const homeRoot = path.join(workRoot, 'home');
await mkdir(extractRoot, { recursive: true });
await mkdir(dataRoot, { recursive: true, mode: 0o700 });
await mkdir(homeRoot, { recursive: true });

const extracted = spawnSync('dpkg-deb', ['-x', artifact, extractRoot], { encoding: 'utf8' });
if (extracted.status !== 0) {
  console.error('engine clean-install test: dpkg-deb -x failed');
  console.error(extracted.stderr);
  process.exit(2);
}

const installDir = path.join(extractRoot, config.installationRoot.replace(/^\/+/, ''));
const engineRoot = path.join(installDir, 'resources', 'engine');
const hostEntry = path.join(engineRoot, 'bin', 'qms-host.js');
const packageJson = JSON.parse(await readFile(path.join(engineRoot, 'package.json'), 'utf8'));
const expectedVersion = String(args['expected-version'] ?? version);
const runtimeBinary = runtime === 'electron'
  ? path.join(installDir, config.executableName)
  : process.execPath;

const hidden = [];
for (const name of hiddenModules) {
  const source = path.join(engineRoot, 'node_modules', name);
  try {
    await stat(source);
  } catch {
    console.error('engine clean-install test: cannot hide ' + name + '; it is not present in the extracted engine.');
    await rm(workRoot, { recursive: true, force: true });
    process.exit(2);
  }
  const target = source + '.qms-hidden';
  await rename(source, target);
  hidden.push(name);
}

function runHandshake(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(runtimeBinary, [hostEntry], {
      cwd: engineRoot,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: homeRoot,
        XDG_CONFIG_HOME: path.join(homeRoot, '.config'),
        XDG_DATA_HOME: path.join(homeRoot, '.local/share'),
        LANG: process.env.LANG ?? 'C.UTF-8',
        ELECTRON_RUN_AS_NODE: runtime === 'electron' ? '1' : undefined,
        QMS_DATA_ROOT: dataRoot,
        QMS_REPO_ROOT: engineRoot
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', stdout, stderr }), timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        resolve({ ...value, stdout, stderr, exitCode: child.exitCode });
      }, 500);
      child.once('exit', () => {
        resolve({ ...value, stdout, stderr, exitCode: child.exitCode });
      });
    }
    lines.on('line', (line) => {
      stdout += line + '\n';
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1) return;
      if (message.error) {
        finish({ ok: false, reason: 'jsonrpc-error', error: message.error });
      } else {
        finish({ ok: true, result: message.result });
      }
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => finish({ ok: false, reason: 'spawn-error', error: { message: error.message } }));
    child.on('exit', (code) => {
      if (!settled) finish({ ok: false, reason: 'early-exit', code });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'engine.info', params: {} }) + '\n');
  });
}

const started = Date.now();
const handshake = await runHandshake();
const durationMs = Date.now() - started;
const apiVersion = handshake.result ? handshake.result.apiVersion : null;
const reportedVersion = handshake.result ? handshake.result.version : null;
const runtimeVersion = runtime === 'electron' ? 'bundled Electron (ELECTRON_RUN_AS_NODE=1)' : process.version;
const failureText = [handshake.stderr, JSON.stringify(handshake.error ?? {})].filter(Boolean).join('\n');

let ok;
let detector = null;
if (expectFailure) {
  const detected = handshake.ok === false && /ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(failureText);
  const namesHidden = hiddenModules.every((name) => !failureText || failureText.includes(name));
  ok = detected && namesHidden && hiddenModules.length > 0;
  detector = {
    expected: 'engine startup fails when a runtime dependency is removed',
    detected,
    mentionsHiddenModule: namesHidden,
    hiddenModules
  };
} else {
  ok = handshake.ok === true && apiVersion === 'qms-engine@1' && reportedVersion === expectedVersion;
}

const evidence = {
  schema: expectFailure ? 'qms-engine-clean-install-negative@1' : 'qms-engine-clean-install@1',
  status: ok ? 'pass' : 'fail',
  artifact: path.basename(artifact),
  artifactBytes,
  artifactSha256: artifactSha,
  version: expectedVersion,
  enginePackageVersion: packageJson.version,
  runtime,
  runtimeVersion,
  engineRoot: path.join(config.installationRoot, 'resources/engine'),
  entry: 'bin/qms-host.js',
  handshake: {
    method: 'engine.info',
    ok: handshake.ok === true,
    apiVersion,
    engineVersion: reportedVersion,
    durationMs,
    reason: handshake.reason ?? null,
    exitCode: handshake.exitCode ?? null
  },
  hiddenModules,
  detector,
  stderrExcerpt: handshake.stderr.slice(-4000),
  stdoutExcerpt: handshake.stdout.slice(-2000),
  ranAt: new Date().toISOString()
};

await writeFile(out, JSON.stringify(evidence, null, 2) + '\n');
if (!keep) await rm(workRoot, { recursive: true, force: true });

if (!ok) {
  console.error('engine clean-install test FAILED (' + evidence.schema + ')');
  console.error(JSON.stringify({
    handshake: evidence.handshake,
    detector,
    hiddenModules,
    stderr: evidence.stderrExcerpt
  }, null, 2));
  process.exit(1);
}
console.log((expectFailure ? 'engine missing-dependency detector passed: ' : 'engine clean-install handshake passed: ') + JSON.stringify({
  artifact: evidence.artifact,
  version: evidence.version,
  runtimeVersion,
  apiVersion,
  engineVersion: reportedVersion,
  durationMs,
  evidence: path.relative(REPO_ROOT, out)
}));


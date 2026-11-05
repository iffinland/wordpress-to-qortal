#!/usr/bin/env node
/**
 * Vertical proof for the packaged engine: extract the built .deb and drive the
 * exact JSON-RPC calls the desktop wizard uses — project.create,
 * source.discover and plan.create — against a local WordPress fixture.
 *
 * Usage:
 *   node scripts/release/engine-wizard-flow-test.mjs
 *   node scripts/release/engine-wizard-flow-test.mjs --artifact=<deb> --out=<json>
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, artifactName, readJson, sha256File } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';
import { startWordpressFixtureServer, createFixtureData } from '../../test-support/wordpress/fixtureServer.js';

const rawArgs = process.argv.slice(2);
const args = Object.fromEntries(rawArgs.map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const keep = args.keep === true;
const runtime = String(args.runtime ?? 'node');
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const version = componentVersion(release, 'desktop');
const artifact = path.resolve(args.artifact ?? path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, version, release.architecture)));
const out = path.resolve(args.out ?? path.join(REPO_ROOT, 'desktop/release', 'engine-wizard-flow.json'));

try {
  await stat(artifact);
} catch {
  console.error('engine wizard flow test: artifact not found: ' + artifact);
  process.exit(2);
}
if (!['node', 'electron'].includes(runtime)) {
  console.error('engine wizard flow test: --runtime must be node or electron');
  process.exit(2);
}

const artifactSha = await sha256File(artifact);
const artifactBytes = (await stat(artifact)).size;
const workRoot = await mkdtemp(path.join(tmpdir(), 'qms-wizard-flow-'));
const extractRoot = path.join(workRoot, 'root');
const dataRoot = path.join(workRoot, 'data');
const homeRoot = path.join(workRoot, 'home');
await mkdir(extractRoot, { recursive: true });
await mkdir(dataRoot, { recursive: true, mode: 0o700 });
await mkdir(homeRoot, { recursive: true });

const extracted = spawnSync('dpkg-deb', ['-x', artifact, extractRoot], { encoding: 'utf8' });
if (extracted.status !== 0) {
  console.error('engine wizard flow test: dpkg-deb -x failed');
  console.error(extracted.stderr);
  process.exit(2);
}
const installDir = path.join(extractRoot, config.installationRoot.replace(/^\/+/, ''));
const engineRoot = path.join(installDir, 'resources', 'engine');
const hostEntry = path.join(engineRoot, 'bin', 'qms-host.js');
const runtimeBinary = runtime === 'electron' ? path.join(installDir, config.executableName) : process.execPath;

function datedPost(index, date) {
  return {
    id: 7000 + index,
    slug: 'flow-post-' + index,
    title: 'Flow post ' + index,
    content: '<p>Flow body ' + index + '</p>',
    excerpt: '<p>Flow excerpt ' + index + '</p>',
    date,
    date_gmt: date,
    modified: date,
    modified_gmt: date,
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: []
  };
}

const data = createFixtureData();
data.posts = [
  datedPost(1, '2026-11-01T10:00:00'),
  datedPost(2, '2026-11-02T10:00:00'),
  datedPost(3, '2026-11-03T10:00:00'),
  datedPost(4, '2026-11-04T10:00:00'),
  datedPost(5, '2026-11-05T10:00:00'),
  datedPost(6, '2026-10-01T10:00:00')
];
data.pages = [];
data.media = [];
const wp = await startWordpressFixtureServer({ data });

let child = null;
let stderr = '';
let evidence;
try {
  child = spawn(runtimeBinary, [hostEntry], {
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
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const { JsonRpcConnection } = await import(pathToFileURL(path.join(engineRoot, 'lib/engine/host/client.js')).href);
  const connection = new JsonRpcConnection({ input: child.stdout, output: child.stdin });

  const project = await connection.request('project.create', {
    name: 'Packaged wizard flow',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: 'developer iffi' },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0 },
      media: { allowLoopback: true, maxRetries: 0, retryDelayMs: 0 }
    }
  });

  const discovered = await connection.request('source.discover', {
    projectId: project.id,
    adapterId: 'wordpress',
    contentTypes: ['post', 'page'],
    perPage: 100
  });
  if (discovered.status !== 'completed') throw new Error('discovery did not complete: ' + JSON.stringify(discovered.error ?? {}));

  const planOptions = (after, before) => ({
    batchSize: 5,
    filters: { contentTypes: ['post', 'page'], after, before },
    planning: { includeReserved: false, includePages: true },
    disk: {
      reserveBytes: 0,
      maxBytesPerRun: 0,
      maxFileBytes: 256 * 1024 * 1024,
      maxFilesPerRun: 500,
      unknownSizePolicy: 'reject'
    },
    media: { allowExternalMedia: false, concurrency: 4 },
    estimateMedia: false,
    persist: false
  });

  const preview = await connection.request('plan.create', {
    projectId: project.id,
    ...planOptions('2026-11-01T00:00:00.000Z', '2026-11-05T23:59:59.999Z')
  });
  const empty = await connection.request('plan.create', {
    projectId: project.id,
    ...planOptions('2026-10-05T00:00:00.000Z', '2026-10-21T23:59:59.999Z')
  });
  await connection.request('project.close', { projectId: project.id });
  connection.close();

  const selected = Number(preview.stats?.selected ?? 0);
  const emptySelected = Number(empty.stats?.selected ?? 0);
  const emptyReasons = empty.plan?.selection?.emptyExplanation ?? [];
  const pass = preview.status === 'completed' &&
    preview.plan?.status === 'ready' &&
    selected === 5 &&
    empty.status === 'completed' &&
    emptySelected === 0 &&
    empty.plan?.selection?.empty === true &&
    empty.plan?.filterDiagnostics?.publishedAfterBefore === 5 &&
    empty.plan?.filterDiagnostics?.publishedBeforeAfter === 1;

  evidence = {
    schema: 'qms-engine-wizard-flow@1',
    status: pass ? 'pass' : 'fail',
    artifact: path.basename(artifact),
    artifactBytes,
    artifactSha256: artifactSha,
    version,
    runtime,
    engineRoot: path.join(config.installationRoot, 'resources/engine'),
    projectId: project.id,
    discovery: { status: discovered.status, batchId: discovered.batchId ?? null },
    plan: {
      status: preview.status,
      planStatus: preview.plan?.status ?? null,
      planId: preview.planId ?? null,
      selected,
      filters: preview.plan?.filters ?? null,
      messages: (preview.plan?.selection?.emptyExplanation ?? [])
    },
    emptyPlan: {
      status: empty.status,
      selected: emptySelected,
      empty: empty.plan?.selection?.empty === true,
      emptyReason: empty.plan?.selection?.emptyReason ?? null,
      filterDiagnostics: empty.plan?.filterDiagnostics ?? null,
      messages: emptyReasons
    },
    stderrExcerpt: stderr.slice(-4000),
    ranAt: new Date().toISOString()
  };
} catch (error) {
  evidence = {
    schema: 'qms-engine-wizard-flow@1',
    status: 'fail',
    artifact: path.basename(artifact),
    artifactBytes,
    artifactSha256: artifactSha,
    version,
    runtime,
    error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
    stderrExcerpt: stderr.slice(-4000),
    ranAt: new Date().toISOString()
  };
} finally {
  try { child?.kill('SIGTERM'); } catch { /* already gone */ }
  await wp.close().catch(() => {});
  await writeFile(out, JSON.stringify(evidence, null, 2) + '\n');
  if (!keep) await rm(workRoot, { recursive: true, force: true });
}

if (evidence.status !== 'pass') {
  console.error('engine wizard flow test FAILED');
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
}
console.log('engine wizard flow test passed: ' + JSON.stringify({
  artifact: evidence.artifact,
  version: evidence.version,
  selected: evidence.plan.selected,
  emptySelected: evidence.emptyPlan.selected,
  emptyReason: evidence.emptyPlan.emptyReason,
  evidence: path.relative(REPO_ROOT, out)
}));

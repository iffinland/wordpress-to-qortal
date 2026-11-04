import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { createEngine } from '../../lib/engine/index.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'bin', 'qms.js'), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('qms source CLI exposes capabilities and runs fixture discovery', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-cli-source-'));
  const server = await startWordpressFixtureServer();
  t.after(async () => {
    await server.close();
    await rm(dataRoot, { recursive: true, force: true });
  });
  const env = { QMS_DATA_ROOT: dataRoot };

  const capabilities = await runCli(['source', 'capabilities', '--json'], env);
  assert.equal(capabilities.code, 0, capabilities.stderr);
  const parsed = JSON.parse(capabilities.stdout);
  assert.equal(parsed.id, 'wordpress');
  assert.deepEqual(parsed.capabilities.contentTypes, ['post', 'page']);

  const engine = createEngine({ dataRoot });
  const project = await engine.projects.create({
    name: 'CLI Source',
    source: { adapter: 'wordpress', baseUrl: server.url }
  });
  await engine.close();

  const validation = await runCli(['source', 'validate', project.id, '--json'], env);
  assert.equal(validation.code, 0, validation.stderr);
  const validationResult = JSON.parse(validation.stdout);
  assert.equal(validationResult.status, 'completed');

  const discovery = await runCli(['source', 'discover', project.id, '--per-page', '2', '--max-items', '4', '--json'], env);
  assert.equal(discovery.code, 0, discovery.stderr);
  const discoveryResult = JSON.parse(discovery.stdout);
  assert.equal(discoveryResult.status, 'completed');
  assert.equal(discoveryResult.summary.items, 4);
  assert.equal(discoveryResult.summary.truncated, true);
});

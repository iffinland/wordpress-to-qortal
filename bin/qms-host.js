#!/usr/bin/env node
/**
 * qms-host: stdio JSON-RPC host used by the desktop main process.
 *
 * The engine stays independent of Electron. The desktop spawns this entry with
 * Electron's bundled Node runtime (ELECTRON_RUN_AS_NODE=1), so no system Node,
 * npm or Git installation is required on the target machine.
 */
import { createEngine } from '../lib/engine/index.js';
import { runHost } from '../lib/engine/host/server.js';

const engine = createEngine({
  dataRoot: process.env.QMS_DATA_ROOT ? process.env.QMS_DATA_ROOT : undefined,
  repoRoot: process.env.QMS_REPO_ROOT ? process.env.QMS_REPO_ROOT : undefined
});

const host = await runHost({ engine });

async function shutdown() {
  await host.shutdown();
  await engine.close().catch(() => {});
}

process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
process.on('uncaughtException', (error) => {
  process.stderr.write('qms-host uncaught: ' + (error?.message ?? String(error)) + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  process.stderr.write('qms-host rejection: ' + (error?.message ?? String(error)) + '\n');
  process.exit(1);
});

await host.closed;
await engine.close().catch(() => {});

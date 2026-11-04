/**
 * Read-only verification that an existing installed data root still contains a
 * project after an upgrade, removal and reinstall. Never mutates project data.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const index = value.indexOf('=');
  return index === -1 ? [value.replace(/^--/, ''), true] : [value.slice(2, index), value.slice(index + 1)];
}));
const engineRoot = path.resolve(args.engine ?? process.env.QMS_ENGINE_ROOT ?? '');
const dataRoot = path.resolve(args['data-root'] ?? process.env.QMS_DATA_ROOT ?? '');
if (!engineRoot || !dataRoot) {
  console.error('usage: verifyData.mjs --engine=<resources/engine> --data-root=<dir>');
  process.exit(2);
}
const child = spawn(process.execPath, [path.join(engineRoot, 'bin/qms-host.js')], {
  cwd: engineRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QMS_DATA_ROOT: dataRoot, QMS_REPO_ROOT: engineRoot },
  stdio: ['pipe', 'pipe', 'pipe']
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += String(chunk); });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(Number(message.id));
  if (!waiter) return;
  pending.delete(Number(message.id));
  if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { data: message.error.data }));
  else waiter.resolve(message.result);
});
function request(method, params = {}, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + method)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
let result;
try {
  const projects = await request('project.list', { includeArchived: true });
  const list = Array.isArray(projects) ? projects : projects.projects ?? [];
  if (list.length === 0) throw new Error('no project survived reinstall');
  const first = list[0];
  const inspection = await request('project.inspect', { projectId: first.id });
  result = { ok: true, projects: list.length, projectId: first.id, name: first.name ?? inspection.name ?? null };
} catch (error) {
  result = { ok: false, error: error.message, stderr: stderr.slice(-2000) };
}
child.kill('SIGTERM');
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

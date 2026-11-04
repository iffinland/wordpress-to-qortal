import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const electron = path.join(root, 'node_modules/.bin/electron');
const child = spawn(electron, ['.', '--qms-smoke-test', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'], {
  cwd: root,
  env: { ...process.env, QMS_SMOKE_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let out = '';
let err = '';
child.stdout.on('data', (chunk) => { out += chunk.toString(); });
child.stderr.on('data', (chunk) => { err += chunk.toString(); });
const timer = setTimeout(() => {
  child.kill('SIGKILL');
  console.error('smoke test timed out');
  process.exit(2);
}, 45000);
child.on('exit', (code) => {
  clearTimeout(timer);
  if (out.includes('QMS_SMOKE_OK') && code === 0) {
    console.log('smoke test passed');
    process.exit(0);
  }
  console.error('smoke test failed, exit=' + code);
  console.error('stdout:\n' + out.slice(-4000));
  console.error('stderr:\n' + err.slice(-4000));
  process.exit(1);
});


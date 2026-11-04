import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = join(root, 'broker/scripts/deploy-phase5.2-readback-fix.sh');
const script = readFileSync(scriptPath, 'utf8');

test('readback deploy script resolves the installed module and restarts only the broker', () => {
  assert.ok(script.includes('../../lib/engine/publication/remote.js'));
  assert.ok(script.includes('grep -oF'));
  assert.ok(script.includes('resolve_installed_module'));
  assert.ok(script.includes('cp -a "$INSTALLED_REMOTE"'));
  assert.ok(script.includes('install -m 0640 -o root -g "$BROKER_USER"'));
  assert.ok(script.includes('cmp -s "$SOURCE_REMOTE" "$INSTALLED_REMOTE"'));
  assert.ok(script.includes('systemctl restart "$BROKER_SERVICE"'));
  assert.equal(script.includes('systemctl restart "$EA_SERVICE"'), false);
  assert.equal(script.includes('external-auth-token'), false);
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

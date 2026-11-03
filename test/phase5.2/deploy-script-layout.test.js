import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = join(root, 'broker/scripts/deploy-phase5.2-core-rejection-fix.sh');
const unlockPath = join(root, 'broker/scripts/operator-unlock-external-auth.sh');
const script = readFileSync(scriptPath, 'utf8');
const user = process.env.USER || process.env.LOGNAME || 'iffi';

test('deployment script targets the actual layout and the correct service order', () => {
  assert.ok(script.includes('REPO_DIR=${REPO_DIR:-/home/iffiolen/qms-broker-deploy}'));
  assert.ok(script.includes('EA_REPO_DIR=${EA_REPO_DIR:-/home/iffiolen/qortal-external-auth-src}'));
  assert.ok(script.includes('EA_INSTALL_DIR=${EA_INSTALL_DIR:-/opt/qortal-external-auth}'));
  assert.ok(script.includes('BROKER_SRC_DIR=${BROKER_SRC_DIR:-$BROKER_DIR/broker/src}'));
  assert.ok(script.includes('BROKER_SCRIPT_DIR=${BROKER_SCRIPT_DIR:-$BROKER_DIR/broker/scripts}'));
  assert.ok(script.includes('--core-api-key-file'));
  assert.ok(script.includes('operator-unlock-external-auth.sh'));
  assert.ok(script.includes('qortal-external-auth-0.2.0-core-diagnostics.patch'));
  assert.equal(script.includes('VERIFY_KEY_FILE'), false);
  assert.equal(script.includes('deploy-verify.key'), false);

  const stopBroker = script.indexOf('systemctl stop "$BROKER_SERVICE"');
  const restartEa = script.indexOf('systemctl restart "$EA_SERVICE"');
  const startBroker = script.indexOf('systemctl start "$BROKER_SERVICE"');
  const startCred = script.indexOf('systemctl start "$CRED_TIMER"');
  assert.ok(stopBroker > 0, 'broker stop missing');
  assert.ok(restartEa > stopBroker, 'External Auth must restart after the broker stops');
  assert.ok(startBroker > restartEa, 'broker must start after External Auth is healthy');
  assert.ok(startCred > startBroker, 'credential renewal must run after the broker is up');

  for (const file of [scriptPath, unlockPath]) {
    const syntax = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test('both External Auth patches are complete files that end with a newline', () => {
  for (const name of [
    'qortal-external-auth-0.2.0-qdn-publish.patch',
    'qortal-external-auth-0.2.0-core-diagnostics.patch'
  ]) {
    const patch = readFileSync(join(root, 'patches', name), 'utf8');
    assert.ok(patch.startsWith('diff --git '), name + ' has no diff header');
    assert.ok(patch.includes('@@ '), name + ' has no hunk');
    assert.ok(patch.endsWith('\n'), name + ' must end with a newline');
    // The previous fee patch was truncated inside its last hunk and git apply
    // rejected it as corrupt. A line count check catches that class early.
    assert.ok(patch.split('\n').length > 40, name + ' looks truncated');
  }
});

test('preflight runs against a realistic signing-VPS fixture', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qms-deploy-fixture-'));
  try {
    for (const dir of [
      'repo/broker/src', 'repo/broker/scripts', 'repo/patches',
      'installed/broker/src', 'installed/broker/scripts',
      'ea-src/packages/auth-daemon/src', 'ea-install/packages/auth-daemon/dist',
      'etc', 'var', 'run', 'backups', 'bin'
    ]) mkdirSync(join(tmp, dir), { recursive: true });

    writeFileSync(join(tmp, 'repo/broker/src/index.js'), 'export const fixture = true;\n');
    writeFileSync(join(tmp, 'installed/broker/src/index.js'), 'export const fixture = true;\n');
    writeFileSync(join(tmp, 'repo/patches/qortal-external-auth-0.2.0-qdn-publish.patch'), 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n');
    writeFileSync(join(tmp, 'repo/patches/qortal-external-auth-0.2.0-core-diagnostics.patch'), 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n');

    // Patched External Auth source checkout, detected by content markers.
    writeFileSync(join(tmp, 'ea-src/packages/auth-daemon/src/index.ts'),
      'let feeValue: number = 0;\nconst basePath = encodeURIComponent(String(service)) + encodeURIComponent(String(resolvedName));\nnodeErrorDiagnostic;\n');
    writeFileSync(join(tmp, 'ea-src/packages/auth-daemon/src/publishDiagnostics.ts'), 'export const x = 1;\n');
    const gitInit = spawnSync('git', ['init', '-q', join(tmp, 'ea-src')], { encoding: 'utf8' });
    assert.equal(gitInit.status, 0, gitInit.stderr);

    writeFileSync(join(tmp, 'ea-install/package.json'), '{"version":"0.2.0"}\n');
    writeFileSync(join(tmp, 'etc/config.json'), '{}\n');
    writeFileSync(join(tmp, 'etc/clients.json'), JSON.stringify({
      schema: 'qms-broker-client-keys@2',
      keys: [{ keyId: 'agent-fixture', publicKeyPem: 'fixture-public-key', enabled: true }]
    }) + '\n');
    writeFileSync(join(tmp, 'var/state.json'), '{"budget":{"spentAtomic":0}}\n');
    writeFileSync(join(tmp, 'var/audit.jsonl'), '');
    writeFileSync(join(tmp, 'etc/apikey.txt'), 'fixture-core-api-key\n');
    chmodSync(join(tmp, 'etc/config.json'), 0o640);
    chmodSync(join(tmp, 'etc/clients.json'), 0o640);
    chmodSync(join(tmp, 'var'), 0o700);
    chmodSync(join(tmp, 'var/state.json'), 0o600);
    chmodSync(join(tmp, 'var/audit.jsonl'), 0o600);

    const sysctl = [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  show) echo "MainPID=1234" ;;',
      '  cat|is-active|is-enabled|start|stop|restart|status|daemon-reload) exit 0 ;;',
      '  *) exit 0 ;;',
      'esac'
    ].join('\n');
    writeFileSync(join(tmp, 'bin/systemctl'), sysctl + '\n');
    writeFileSync(join(tmp, 'bin/ss'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(tmp, 'bin/systemctl'), 0o755);
    chmodSync(join(tmp, 'bin/ss'), 0o755);

    const env = {
      ...process.env,
      PATH: join(tmp, 'bin') + ':' + process.env.PATH,
      REPO_DIR: join(tmp, 'repo'),
      EA_REPO_DIR: join(tmp, 'ea-src'),
      EA_INSTALL_DIR: join(tmp, 'ea-install'),
      BROKER_DIR: join(tmp, 'installed'),
      BROKER_SRC_DIR: join(tmp, 'installed/broker/src'),
      BROKER_SCRIPT_DIR: join(tmp, 'installed/broker/scripts'),
      BROKER_CONFIG: join(tmp, 'etc/config.json'),
      CLIENTS_FILE: join(tmp, 'etc/clients.json'),
      STATE_FILE: join(tmp, 'var/state.json'),
      AUDIT_FILE: join(tmp, 'var/audit.jsonl'),
      KILL_SWITCH_FILE: join(tmp, 'var/DISABLED'),
      ADMIN_SOCKET: join(tmp, 'run/admin.sock'),
      CRED_SOCKET: join(tmp, 'run/credential.sock'),
      TOKEN_FILE: join(tmp, 'etc/token'),
      BACKUP_ROOT: join(tmp, 'backups'),
      EA_KEY_ENV_FILE: join(tmp, 'etc/node-api-key.env'),
      EA_DROPIN_DIR: join(tmp, 'etc/systemd/qortal-external-auth.service.d'),
      EA_DROPIN: join(tmp, 'etc/systemd/qortal-external-auth.service.d/10-node-api-key.conf'),
      CORE_API_KEY_FILE: join(tmp, 'etc/apikey.txt'),
      EA_SERVICE: 'fixture-ea',
      BROKER_SERVICE: 'fixture-broker',
      CRED_TIMER: 'fixture-timer',
      CRED_SERVICE: 'fixture-credential',
      BROKER_USER: user,
      EA_USER: user,
      OWNER_USER: user
    };
    const result = spawnSync('bash', [scriptPath, '--check'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /preflight OK/);
    assert.match(result.stdout, /fee=applied diagnostics=applied/);
    assert.match(result.stdout, /Core API key: configured/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

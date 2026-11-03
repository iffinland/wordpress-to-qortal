import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = join(root, 'broker/scripts/deploy-phase5.2-external-auth-fix.sh');
const script = readFileSync(scriptPath, 'utf8');
const user = process.env.USER || process.env.LOGNAME || 'iffi';

test('deployment script targets actual layout and broker-first ordering', () => {
  assert.ok(script.includes('REPO_DIR=${REPO_DIR:-/home/iffiolen/qms-broker-deploy}'));
  assert.ok(script.includes('EA_REPO_DIR=${EA_REPO_DIR:-/home/iffiolen/qortal-external-auth-src}'));
  assert.ok(script.includes('EA_INSTALL_DIR=${EA_INSTALL_DIR:-/opt/qortal-external-auth}'));
  assert.ok(script.includes('BROKER_SRC_DIR=${BROKER_SRC_DIR:-$BROKER_DIR/broker/src}'));
  assert.ok(script.includes('BROKER_SCRIPT_DIR=${BROKER_SCRIPT_DIR:-$BROKER_DIR/broker/scripts}'));
  assert.equal(script.includes('VERIFY_KEY_FILE'), false);
  assert.equal(script.includes('deploy-verify.key'), false);
  assert.equal(script.includes('EA_PINNED_COMMIT'), false);
  assert.equal(script.includes('systemctl restart "$EA_SERVICE"'), false);
  const brokerStart = script.lastIndexOf('systemctl start "$BROKER_SERVICE"');
  const credStart = script.lastIndexOf('systemctl start "$CRED_TIMER"');
  assert.ok(brokerStart > 0 && credStart > brokerStart);
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('preflight runs against a realistic signing-VPS fixture', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qms-deploy-fixture-'));
  try {
    for (const dir of [
      'repo/broker/src', 'repo/broker/scripts', 'installed/broker/src',
      'installed/broker/scripts', 'ea-src', 'ea-install', 'etc', 'var',
      'run', 'backups', 'bin'
    ]) mkdirSync(join(tmp, dir), { recursive: true });

    writeFileSync(join(tmp, 'repo/broker/src/index.js'), 'export const fixture = true;\n');
    writeFileSync(join(tmp, 'installed/broker/src/index.js'), 'export const fixture = true;\n');
    writeFileSync(join(tmp, 'ea-src/package.json'), '{"version":"0.2.0"}\n');
    writeFileSync(join(tmp, 'ea-install/package.json'), '{"version":"0.2.0"}\n');
    writeFileSync(join(tmp, 'etc/config.json'), '{}\n');
    writeFileSync(join(tmp, 'etc/clients.json'), JSON.stringify({
      schema: 'qms-broker-client-keys@2',
      keys: [{ keyId: 'agent-fixture', publicKeyPem: 'fixture-public-key', enabled: true }]
    }) + '\n');
    writeFileSync(join(tmp, 'var/state.json'), '{"budget":{"spentAtomic":0}}\n');
    writeFileSync(join(tmp, 'var/audit.jsonl'), '');
    chmodSync(join(tmp, 'etc/config.json'), 0o640);
    chmodSync(join(tmp, 'etc/clients.json'), 0o640);
    chmodSync(join(tmp, 'var'), 0o700);
    chmodSync(join(tmp, 'var/state.json'), 0o600);
    chmodSync(join(tmp, 'var/audit.jsonl'), 0o600);

    const sysctl = [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  cat|is-active|is-enabled|start|stop|restart|status) exit 0 ;;',
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
      BACKUP_ROOT: join(tmp, 'backups'),
      EA_SERVICE: 'fixture-ea',
      BROKER_SERVICE: 'fixture-broker',
      CRED_TIMER: 'fixture-timer',
      CRED_SERVICE: 'fixture-credential',
      BROKER_USER: user,
      OWNER_USER: user
    };
    const result = spawnSync('bash', [scriptPath, '--check'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /preflight OK/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

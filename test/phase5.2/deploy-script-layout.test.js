import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canUseUserNamespace,
  createDeploymentFixture,
  extractBackupDir,
  readActionLog,
  runDeployment
} from './support/deployment-fixture.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = join(root, 'broker/scripts/deploy-phase5.2-core-rejection-fix.sh');
const provisionerPath = join(root, 'broker/scripts/provision-external-auth-token.js');
const unlockPath = join(root, 'broker/scripts/operator-unlock-external-auth.sh');
const script = readFileSync(scriptPath, 'utf8');
const userns = canUseUserNamespace();

test('deployment script reads the token path from config and no longer patches or rebuilds External Auth', () => {
  assert.match(script, /^TOKEN_FILE=$/m);
  assert.equal(script.includes('/etc/qms-qdn-test-broker/external-auth-token'), false);
  assert.ok(script.includes('signing.externalAuth.tokenFile'));
  assert.ok(script.includes('provision-external-auth-token.js'));
  assert.ok(script.includes('resolve_token_file'));
  assert.ok(script.includes('runuser'));
  assert.ok(script.includes('--force'));
  assert.ok(script.includes('operator-unlock-external-auth.sh'));

  assert.equal(script.includes('EA_REPO_DIR'), false);
  assert.equal(script.includes('PATCH_FEE'), false);
  assert.equal(script.includes('qortal-external-auth-0.2.0'), false);
  assert.equal(script.includes('npm ci'), false);
  assert.equal(script.includes('npm run build'), false);
  assert.equal(script.includes('apply_ea_patches'), false);
  assert.equal(script.includes('build_and_install_ea'), false);

  for (const marker of ['privateKey', 'SIGN_TRANSACTION', 'seedPhrase', 'BEGIN PRIVATE KEY', '/wallet/unlock']) {
    assert.equal(script.includes(marker), false, 'deployment must not require ' + marker);
  }

  for (const file of [scriptPath, unlockPath]) {
    const syntax = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const provisionerSyntax = spawnSync(process.execPath, ['--check', provisionerPath], { encoding: 'utf8' });
  assert.equal(provisionerSyntax.status, 0, provisionerSyntax.stderr);
});

test('check mode reads a non-default token path from the installed broker config and makes no changes', async () => {
  const fixture = await createDeploymentFixture({ tokenRelative: 'var/broker/custom-token' });
  try {
    const result = await runDeployment(fixture, ['--check']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp('broker token file from config: ' + fixture.tokenPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.stdout, /preflight OK/);
    assert.match(result.stdout, /Core API key: configured/);
    assert.match(result.stdout, /External Auth restart required to load the Core API key: yes/);

    assert.equal(existsSync(fixture.tokenPath), false);
    assert.equal(existsSync(fixture.eaKeyEnvFile), false);
    assert.deepEqual(readdirSync(fixture.backupRoot), []);
    const actions = readActionLog(fixture);
    assert.equal(actions.some((line) => /systemctl (start|stop|restart|daemon-reload)/.test(line)), false);
  } finally {
    await fixture.close();
  }
});

test('key-change deployment provisions before broker start and prints exactly one unlock action', { skip: userns ? false : 'user namespaces unavailable' }, async () => {
  const fixture = await createDeploymentFixture();
  try {
    const result = await runDeployment(fixture, ['--yes', '--core-api-key-file', fixture.apikeyFile]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Core API key validated/);
    assert.match(result.stdout, /DEPLOYMENT COMPLETE/);
    assert.match(result.stdout, /verification OK/);
    assert.equal((result.stdout.match(/OPERATOR UNLOCK ACTION/g) || []).length, 1);

    assert.ok(existsSync(fixture.tokenPath));
    assert.equal(statSync(fixture.tokenPath).mode & 0o777, 0o600);
    const token = readFileSync(fixture.tokenPath, 'utf8').trim();
    assert.match(token, /^[A-Za-z0-9._~+\/-]{20,4096}$/);
    assert.ok(existsSync(fixture.eaKeyEnvFile));
    assert.equal(statSync(fixture.eaKeyEnvFile).mode & 0o777, 0o600);
    assert.ok(existsSync(fixture.eaDropin));

    const actions = readActionLog(fixture);
    const stop = actions.findIndex((line) => line.includes('stop fixture-broker'));
    const restart = actions.findIndex((line) => line.includes('restart fixture-ea'));
    const provision = actions.findIndex((line) => line.includes('runuser') && line.includes('provision-external-auth-token.js'));
    const start = actions.findIndex((line) => line.includes('start fixture-broker'));
    const supervisor = actions.findIndex((line) => line.includes('runuser') && line.includes('credentials/supervisor.js'));
    assert.ok(stop >= 0, 'broker stop missing');
    assert.ok(restart > stop, 'External Auth must restart after the broker stops');
    assert.ok(provision > restart, 'replacement session must be provisioned after External Auth is healthy');
    assert.ok(start > provision, 'broker must start only after the token file exists');
    assert.ok(supervisor > start, 'post-start supervisor renewal must run after the broker is up');
    assert.ok(fixture.pushed.length >= 1, 'post-start supervisor must push a renewed token');
  } finally {
    await fixture.close();
  }
});

test('already-configured key does not restart External Auth and requires no unlock', { skip: userns ? false : 'user namespaces unavailable' }, async () => {
  const fixture = await createDeploymentFixture({ keyAlreadyConfigured: true });
  try {
    const result = await runDeployment(fixture, ['--yes', '--core-api-key-file', fixture.apikeyFile]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /External Auth will not be restarted/);
    assert.match(result.stdout, /External Auth was NOT restarted/);
    assert.equal((result.stdout.match(/OPERATOR UNLOCK ACTION/g) || []).length, 0);

    const actions = readActionLog(fixture);
    assert.equal(actions.some((line) => line.includes('restart fixture-ea')), false);
    const provision = actions.findIndex((line) => line.includes('runuser') && line.includes('provision-external-auth-token.js'));
    const start = actions.findIndex((line) => line.includes('start fixture-broker'));
    assert.ok(provision >= 0 && start > provision, 'broker must still start only after provisioning');
    assert.ok(existsSync(fixture.tokenPath));
  } finally {
    await fixture.close();
  }
});

test('key detection tolerates a large process environment without a SIGPIPE false negative', { skip: userns ? false : 'user namespaces unavailable' }, async () => {
  // A rich environment makes /proc/<pid>/environ span multiple pipe chunks.
  // The pre-fix "tr ... | grep -q" pipeline could return 141 under pipefail
  // when grep exited after the first chunk, falsely reporting a missing key
  // and triggering an unnecessary rollback and unlock action.
  const fixture = await createDeploymentFixture({
    keyAlreadyConfigured: true,
    extraEnv: { QMS_TEST_ENV_PAD: 'x'.repeat(64 * 1024) }
  });
  try {
    const result = await runDeployment(fixture, ['--yes', '--core-api-key-file', fixture.apikeyFile]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /External Auth was NOT restarted/);
    assert.match(result.stdout, /verification OK/);
    assert.equal((result.stdout.match(/OPERATOR UNLOCK ACTION/g) || []).length, 0);
  } finally {
    await fixture.close();
  }
});

test('provisioning failure triggers rollback and never starts the broker', { skip: userns ? false : 'user namespaces unavailable' }, async () => {
  const fixture = await createDeploymentFixture({ failSessions: true });
  try {
    const result = await runDeployment(fixture, ['--yes', '--core-api-key-file', fixture.apikeyFile]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /provisioning a replacement External Auth session before broker start/);
    assert.match(result.stdout, /ROLLBACK INCOMPLETE: no valid External Auth token/);
    assert.ok(existsSync(fixture.killSwitchFile), 'kill switch must remain engaged');
    assert.equal(readActionLog(fixture).some((line) => line.includes('start fixture-broker')), false);

    const backup = extractBackupDir(result.stdout);
    assert.ok(backup, 'backup directory must be reported');
    assert.ok(existsSync(backup), 'backup directory must exist');
    assert.equal((result.stdout.match(/OPERATOR UNLOCK ACTION/g) || []).length, 1);
  } finally {
    await fixture.close();
  }
});

test('explicit rollback restores the previous tree but provisions a fresh token before broker start', { skip: userns ? false : 'user namespaces unavailable' }, async () => {
  const fixture = await createDeploymentFixture();
  try {
    const deployed = await runDeployment(fixture, ['--yes', '--core-api-key-file', fixture.apikeyFile]);
    assert.equal(deployed.status, 0, deployed.stdout + deployed.stderr);
    const backup = extractBackupDir(deployed.stdout);
    assert.ok(backup, 'deployment must report a backup directory');

    writeFileSync(fixture.actionLog, '');
    const rolledBack = await runDeployment(fixture, ['--rollback', backup]);
    assert.equal(rolledBack.status, 0, rolledBack.stdout + rolledBack.stderr);
    assert.match(rolledBack.stdout, /using backed-up token path/);
    assert.match(rolledBack.stdout, /rollback complete/);
    assert.equal((rolledBack.stdout.match(/OPERATOR UNLOCK ACTION/g) || []).length, 1);
    assert.ok(existsSync(fixture.killSwitchFile), 'rollback keeps the kill switch engaged');
    assert.ok(existsSync(fixture.tokenPath), 'rollback must leave a fresh token file');

    const actions = readActionLog(fixture);
    const restart = actions.findIndex((line) => line.includes('restart fixture-ea'));
    const provision = actions.findIndex((line) => line.includes('runuser') && line.includes('provision-external-auth-token.js'));
    const start = actions.findIndex((line) => line.includes('start fixture-broker'));
    assert.ok(restart >= 0, 'rollback must restart External Auth');
    assert.ok(provision > restart, 'rollback must provision a fresh token after the restart');
    assert.ok(start > provision, 'rollback must start the broker only after provisioning');
  } finally {
    await fixture.close();
  }
});

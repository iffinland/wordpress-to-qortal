import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const deployScript = join(repoRoot, 'broker/scripts/deploy-phase5.2-core-rejection-fix.sh');

export function canUseUserNamespace() {
  const probe = spawnSync('unshare', ['-r', 'true'], { encoding: 'utf8' });
  return probe.status === 0;
}

export function tokenFingerprint(token) {
  return 'sha256:' + createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

function listenHttp(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function listenUnix(server, socketPath) {
  rmSync(socketPath, { force: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function writeExecutable(file, content) {
  writeFileSync(file, content, { mode: 0o755 });
  chmodSync(file, 0o755);
}

export async function createDeploymentFixture(options = {}) {
  const {
    tokenRelative = 'var/broker/external-auth-token',
    keyAlreadyConfigured = false,
    failSessions = false
  } = options;

  const root = mkdtempSync(join(tmpdir(), 'qms-final-deploy-'));
  const coreKey = 'fixture-core-api-key';
  const actionLog = join(root, 'actions.log');
  const eaPidFile = join(root, 'ea.pid');
  const tokenPath = join(root, tokenRelative);
  const configPath = join(root, 'etc/broker-config.json');
  const clientsFile = join(root, 'etc/clients.json');
  const stateFile = join(root, 'var/state.json');
  const auditFile = join(root, 'var/audit.jsonl');
  const killSwitchFile = join(root, 'var/DISABLED');
  const adminSocket = join(root, 'run/admin.sock');
  const credSocket = join(root, 'run/credential.sock');
  const backupRoot = join(root, 'backups');
  const supervisorDir = join(root, 'supervisor');
  const supervisorConfig = join(supervisorDir, 'supervisor.json');
  const appFile = join(supervisorDir, 'app.json');
  const eaKeyEnvFile = join(root, 'etc/node-api-key.env');
  const eaDropinDir = join(root, 'systemd/fixture-ea.service.d');
  const eaDropin = join(eaDropinDir, '10-node-api-key.conf');
  const apikeyFile = join(root, 'etc/apikey.txt');

  for (const dir of [
    'repo/broker',
    'installed/broker',
    'etc',
    'var/broker',
    'run',
    'backups',
    'bin',
    'systemd',
    'supervisor'
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  chmodSync(join(root, 'var'), 0o700);
  chmodSync(join(root, 'var/broker'), 0o700);
  chmodSync(join(root, 'run'), 0o710);
  chmodSync(join(root, 'supervisor'), 0o700);

  cpSync(join(repoRoot, 'broker/src'), join(root, 'repo/broker/src'), { recursive: true });
  cpSync(join(repoRoot, 'broker/scripts'), join(root, 'repo/broker/scripts'), { recursive: true });

  // Model the already-installed tree: it has the supervisor and control CLI but
  // not the new pre-broker provisioner.
  cpSync(join(repoRoot, 'broker/src'), join(root, 'installed/broker/src'), { recursive: true });
  cpSync(join(repoRoot, 'broker/scripts'), join(root, 'installed/broker/scripts'), { recursive: true });
  rmSync(join(root, 'installed/broker/scripts/provision-external-auth-token.js'), { force: true });

  writeFileSync(configPath, JSON.stringify({
    signing: {
      backend: 'external-auth',
      externalAuth: {
        baseUrl: 'http://127.0.0.1:3191',
        walletId: 'fixture-wallet',
        tokenFile: tokenPath,
        timeoutMs: 60000,
        expectedAddress: 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E'
      }
    }
  }, null, 2) + '\n', { mode: 0o640 });
  chmodSync(configPath, 0o640);

  writeFileSync(clientsFile, JSON.stringify({
    schema: 'qms-broker-client-keys@2',
    keys: [{ keyId: 'fixture-agent', publicKeyPem: 'fixture-public-key', enabled: true }]
  }) + '\n', { mode: 0o640 });
  chmodSync(clientsFile, 0o640);
  writeFileSync(stateFile, '{"budget":{"spentAtomic":0}}\n', { mode: 0o600 });
  chmodSync(stateFile, 0o600);
  writeFileSync(auditFile, '', { mode: 0o600 });
  chmodSync(auditFile, 0o600);
  writeFileSync(apikeyFile, coreKey + '\n', { mode: 0o600 });
  chmodSync(apikeyFile, 0o600);

  const issued = new Set();
  const sessions = [];
  const pushed = [];

  const eaServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/sessions') {
      await readBody(request);
      if (failSessions) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":"fixture session failure"}');
        return;
      }
      const token = 'tok_' + randomBytes(24).toString('hex');
      issued.add(token);
      sessions.push(token);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ token, expiresAt: Date.now() + 3600_000 }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/settings') {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (issued.has(token)) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      } else {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"error":"unauthorized"}');
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const eaPort = await listenHttp(eaServer);

  const coreServer = createHttpServer((request, response) => {
    if (request.method === 'GET' && request.url === '/admin/apikey/test') {
      if (request.headers['x-api-key'] === coreKey) {
        response.writeHead(200);
        response.end('true');
      } else {
        response.writeHead(401);
        response.end('false');
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const corePort = await listenHttp(coreServer);

  const brokerServer = createHttpServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
  });
  const brokerPort = await listenHttp(brokerServer);

  writeFileSync(supervisorConfig, JSON.stringify({
    schema: 'qms-auth-credential-supervisor@1',
    baseUrl: 'http://127.0.0.1:' + eaPort,
    appSecretFile: appFile,
    socketPath: credSocket,
    statePath: join(supervisorDir, 'state.json'),
    renewBeforeMs: 1200000,
    timeoutMs: 5000
  }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(supervisorConfig, 0o600);
  writeFileSync(appFile, JSON.stringify({
    appId: 'a'.repeat(32),
    appSecret: 'b'.repeat(32)
  }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(appFile, 0o600);

  if (keyAlreadyConfigured) {
    writeFileSync(eaKeyEnvFile, 'QORTAL_AUTH_NODE_API_KEY=' + coreKey + '\n', { mode: 0o600 });
    chmodSync(eaKeyEnvFile, 0o600);
    mkdirSync(eaDropinDir, { recursive: true, mode: 0o755 });
    writeFileSync(eaDropin, '[Service]\nEnvironmentFile=-' + eaKeyEnvFile + '\n', { mode: 0o644 });
    chmodSync(eaDropin, 0o644);
  }

  const adminServer = createNetServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
      const fingerprint = token ? tokenFingerprint(token) : null;
      socket.end(JSON.stringify({
        ok: true,
        status: { credential: { fingerprint, present: Boolean(token) } }
      }) + '\n');
    });
  });
  await listenUnix(adminServer, adminSocket);
  chmodSync(adminSocket, 0o600);

  const credentialServer = createNetServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        socket.end(JSON.stringify({ ok: false, error: 'invalid_json' }) + '\n');
        return;
      }
      if (message.schema !== 'qms-auth-credential@1' || (message.op ?? 'renew') !== 'renew') {
        socket.end(JSON.stringify({ ok: false, error: 'invalid_schema' }) + '\n');
        return;
      }
      if (!issued.has(message.token)) {
        socket.end(JSON.stringify({ ok: false, error: 'AUTH_INVALID_TOKEN' }) + '\n');
        return;
      }
      writeFileSync(tokenPath, String(message.token).trim() + '\n', { mode: 0o600 });
      chmodSync(tokenPath, 0o600);
      pushed.push(message.token);
      socket.end(JSON.stringify({
        ok: true,
        credential: {
          schema: 'qms-external-auth-credential@1',
          present: true,
          fingerprint: tokenFingerprint(message.token),
          expiresAt: message.expiresAt
        }
      }) + '\n');
    });
  });
  await listenUnix(credentialServer, credSocket);
  chmodSync(credSocket, 0o660);

  writeExecutable(join(root, 'bin/systemctl'), [
    '#!/usr/bin/env bash',
    'printf "systemctl %s\\n" "$*" >> "$ACTION_LOG"',
    'case "$1" in',
    '  show)',
    '    case " $* " in',
    '      *" MainPID "*) cat "$EA_PID_FILE" ;;',
    '      *) exit 0 ;;',
    '    esac',
    '    ;;',
    '  *) exit 0 ;;',
    'esac',
    ''
  ].join('\n'));
  writeExecutable(join(root, 'bin/runuser'), [
    '#!/usr/bin/env bash',
    'printf "runuser %s\\n" "$*" >> "$ACTION_LOG"',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -u|-g|-G) shift 2 ;;',
    '    --) shift; break ;;',
    '    *) break ;;',
    '  esac',
    'done',
    'exec "$@"',
    ''
  ].join('\n'));
  writeExecutable(join(root, 'bin/ss'), '#!/usr/bin/env bash\nexit 0\n');

  writeExecutable(join(root, 'run-deploy.sh'), "#!/usr/bin/env bash\nset -u\nexport QORTAL_AUTH_NODE_API_KEY\nprintf '%s\\n' \"$$\" > \"$EA_PID_FILE\"\nbash \"$DEPLOY_SCRIPT\" \"$@\"\nstatus=$?\nrm -f \"$EA_PID_FILE\"\nexit \"$status\"\n");

  const env = { ...process.env };
  delete env.TOKEN_FILE;
  Object.assign(env, {
    PATH: join(root, 'bin') + ':' + process.env.PATH,
    ACTION_LOG: actionLog,
    QORTAL_AUTH_NODE_API_KEY: coreKey,
    EA_PID_FILE: eaPidFile,
    DEPLOY_SCRIPT: deployScript,
    REPO_DIR: join(root, 'repo'),
    BROKER_DIR: join(root, 'installed'),
    BROKER_SRC_DIR: join(root, 'installed/broker/src'),
    BROKER_SCRIPT_DIR: join(root, 'installed/broker/scripts'),
    BROKER_CONFIG: configPath,
    CLIENTS_FILE: clientsFile,
    STATE_FILE: stateFile,
    AUDIT_FILE: auditFile,
    KILL_SWITCH_FILE: killSwitchFile,
    ADMIN_SOCKET: adminSocket,
    CRED_SOCKET: credSocket,
    BACKUP_ROOT: backupRoot,
    EA_SERVICE: 'fixture-ea',
    BROKER_SERVICE: 'fixture-broker',
    CRED_TIMER: 'fixture-timer',
    CRED_SERVICE: 'fixture-credential',
    BROKER_USER: 'root',
    BROKER_GROUP: 'root',
    OWNER_USER: 'root',
    EA_USER: 'root',
    EA_SUPERVISOR_USER: 'root',
    EA_SUPERVISOR_GROUP: 'root',
    SUPERVISOR_CONFIG: supervisorConfig,
    EA_KEY_ENV_FILE: eaKeyEnvFile,
    EA_DROPIN_DIR: eaDropinDir,
    EA_DROPIN: eaDropin,
    CORE_URL: 'http://127.0.0.1:' + corePort,
    CORE_API_KEY_FILE: apikeyFile,
    EA_HEALTH: 'http://127.0.0.1:' + eaPort + '/health',
    BROKER_HEALTH: 'http://127.0.0.1:' + brokerPort + '/v1/health'
  });

  return {
    root,
    env,
    tokenPath,
    tokenRelative,
    configPath,
    clientsFile,
    stateFile,
    auditFile,
    killSwitchFile,
    adminSocket,
    credSocket,
    backupRoot,
    supervisorConfig,
    appFile,
    eaKeyEnvFile,
    eaDropin,
    apikeyFile,
    actionLog,
    eaPidFile,
    eaPort,
    corePort,
    brokerPort,
    issued,
    sessions,
    pushed,
    async close() {
      if (existsSync(eaPidFile)) {
        try { process.kill(Number(readFileSync(eaPidFile, 'utf8').trim()), 'SIGTERM'); } catch { /* already gone */ }
      }
      await closeServer(adminServer);
      await closeServer(credentialServer);
      await closeServer(eaServer);
      await closeServer(coreServer);
      await closeServer(brokerServer);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

export function runDeployment(fixture, args = [], { timeoutMs = 60000 } = {}) {
  const useUnshare = canUseUserNamespace();
  const wrapper = join(fixture.root, 'run-deploy.sh');
  const command = useUnshare ? 'unshare' : 'bash';
  const commandArgs = useUnshare
    ? ['-r', 'bash', wrapper, ...args]
    : [wrapper, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: fixture.root,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('deployment fixture timed out'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

export function readActionLog(fixture) {
  if (!existsSync(fixture.actionLog)) return [];
  return readFileSync(fixture.actionLog, 'utf8').split('\n').filter(Boolean);
}

export function extractBackupDir(stdout) {
  const match = stdout.match(/backup: (\/\S+)/);
  return match ? match[1] : null;
}

#!/usr/bin/env node
/**
 * Pre-broker External Auth session provisioner for Phase 5.2 final deployment.
 *
 * The broker validates its bearer token at startup. After an External Auth
 * restart the previous token is invalid, so the deployment must create a
 * replacement session BEFORE the broker starts and write it to the token path
 * resolved from the installed broker config.
 *
 * This helper uses the existing credential supervisor configuration and app
 * credentials. It only calls POST /sessions and read-only GET /settings. It
 * never touches the broker credential socket (which does not exist yet), never
 * signs or publishes, and never prints the app secret or token. The caller
 * installs the generated private file with the broker user and mode 0600.
 */
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync
} from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createSession,
  loadSupervisorConfig,
  readAppCredentials
} from '../src/credentials/supervisor.js';
import {
  createExternalAuthTokenValidator,
  tokenFingerprint
} from '../src/credentials/store.js';

const TOKEN = /^[A-Za-z0-9._~+\/-]{20,4096}$/;

function usage() {
  process.stderr.write(
    'usage: provision-external-auth-token.js --supervisor-config PATH --output PATH\n'
  );
}

function parseArgs(argv) {
  const args = {
    supervisorConfig:
      process.env.QMS_AUTH_SUPERVISOR_CONFIG ||
      '/etc/qms-qdn-auth-credential/supervisor.json',
    output: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--supervisor-config') args.supervisorConfig = argv[++index] || '';
    else if (arg.startsWith('--supervisor-config=')) args.supervisorConfig = arg.slice('--supervisor-config='.length);
    else if (arg === '--output') args.output = argv[++index] || '';
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  if (!args.supervisorConfig) throw new Error('--supervisor-config is required.');
  if (!args.output) throw new Error('--output is required.');
  return args;
}

function writePrivateFileAtomic(file, contents) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid + '-' + randomBytes(6).toString('hex');
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadSupervisorConfig(args.supervisorConfig);
  const app = readAppCredentials(config.appSecretFile);
  const session = await createSession({
    baseUrl: config.baseUrl,
    appId: app.appId,
    appSecret: app.appSecret,
    timeoutMs: config.timeoutMs
  });
  if (!TOKEN.test(session.token)) {
    throw new Error('External Auth returned no plausible session token.');
  }
  const validate = createExternalAuthTokenValidator({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs
  });
  if (!(await validate(session.token))) {
    throw new Error('External Auth rejected the provisioned session at GET /settings.');
  }
  writePrivateFileAtomic(args.output, session.token + '\n');
  process.stdout.write(
    JSON.stringify({
      schema: 'qms-external-auth-provision@1',
      provisioned: true,
      output: args.output,
      expiresAt: new Date(session.expiresAt).toISOString(),
      fingerprint: tokenFingerprint(session.token)
    }) + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(
    'provisioning failed: ' +
      (error instanceof Error ? error.message : String(error)) +
      '\n'
  );
  process.exit(1);
});

import { loadConfig } from './config.js';
import { loadKeysFile, createNonceCache } from './auth.js';
import { BrokerState } from './state.js';
import { AuditLog } from './audit.js';
import { PublicationBroker } from './service.js';
import { ExternalAuthSigningBackend } from './signing/external-auth.js';
import { createMockSigningBackend } from './signing/mock.js';
import { createBrokerHttpServer, createAdminServer, startHttpServer } from './server.js';
import { BrokerError, BROKER_ERROR } from './errors.js';

function log(message) {
  process.stderr.write('[qms-test-broker] ' + message + '\n');
}

export async function startBroker({ configPath = process.env.QMS_BROKER_CONFIG } = {}) {
  if (!configPath) {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'Set QMS_BROKER_CONFIG or pass a config path.');
  }
  const config = loadConfig(configPath);
  const keys = loadKeysFile(config.auth.keysFile);
  if (keys.size === 0) {
    throw new BrokerError(BROKER_ERROR.AUTH_INVALID, 'At least one client key is required.');
  }

  let backend;
  if (config.signing.backend === 'external-auth') {
    backend = await new ExternalAuthSigningBackend(config.signing.externalAuth).open();
  } else if (process.env.QMS_BROKER_ALLOW_MOCK === '1') {
    backend = createMockSigningBackend();
    log('WARNING: mock signing backend enabled by QMS_BROKER_ALLOW_MOCK=1; never use this in production.');
  } else {
    throw new BrokerError(BROKER_ERROR.INVALID_REQUEST, 'The mock signing backend requires QMS_BROKER_ALLOW_MOCK=1.');
  }

  const state = await BrokerState.open({ path: config.state.path, fsync: config.state.fsync });
  const recovery = await state.recoverInterrupted({ windowMs: config.policy.budgetWindowMs });
  if (recovery.recovered > 0) log('marked ' + recovery.recovered + ' interrupted publication(s) as ambiguous');
  const audit = AuditLog.open({ path: config.audit.path });
  const broker = new PublicationBroker({ config, state, audit, backend });
  const nonceCache = createNonceCache();
  const http = createBrokerHttpServer({ config, broker, keys, nonceCache, audit });
  const admin = createAdminServer({ config, broker, audit });

  await startHttpServer(http, config);
  log('HTTP API listening on ' + config.server.host + ':' + config.server.port);
  if (config.admin.enabled) {
    await admin.listen();
    log('operator control socket listening');
  }

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log('received ' + signal + '; shutting down');
    await new Promise((resolve) => http.close(resolve));
    await admin.close();
    audit.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { config, state, audit, broker, http, admin, backend };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  startBroker().catch((error) => {
    log('startup failed: ' + (error instanceof BrokerError ? error.code + ' ' + error.message : error.message));
    process.exit(1);
  });
}

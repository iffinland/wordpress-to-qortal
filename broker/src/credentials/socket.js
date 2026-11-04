import { chmodSync, existsSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { BrokerError, BROKER_ERROR } from '../errors.js';

export const CREDENTIAL_SOCKET_SCHEMA = 'qms-auth-credential@1';
const MAX_LINE = 16384;

/**
 * Private Unix-socket ingress for renewed External Auth credentials. There is
 * no TCP listener and no generic command surface: the only operations are
 * "status" and "renew". Filesystem permissions restrict writers to the
 * qms-auth-supervisor group; the admin socket stays 0600 in the same runtime
 * directory so that group members cannot use it.
 */
export function createCredentialSocketServer({
  socketPath,
  mode = 0o660,
  store,
  audit = null,
  clock = () => Date.now()
}) {
  let server = null;

  async function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      audit?.append('credential_renew_rejected', { code: 'INVALID_JSON' });
      return { ok: false, error: 'invalid_json' };
    }
    if (!message || message.schema !== CREDENTIAL_SOCKET_SCHEMA) {
      audit?.append('credential_renew_rejected', { code: 'INVALID_SCHEMA' });
      return { ok: false, error: 'invalid_schema' };
    }
    const op = message.op ?? 'renew';
    if (op === 'status') {
      return { ok: true, credential: store.status() };
    }
    if (op !== 'renew') {
      audit?.append('credential_renew_rejected', { code: 'UNKNOWN_OPERATION' });
      return { ok: false, error: 'unknown_operation' };
    }
    try {
      const status = await store.accept({
        token: message.token,
        expiresAt: message.expiresAt ?? null,
        source: 'socket'
      });
      audit?.append('credential_renewed', {
        fingerprint: status.fingerprint,
        expiresAt: status.expiresAt,
        at: new Date(clock()).toISOString()
      });
      return { ok: true, credential: status };
    } catch (error) {
      const code = error instanceof BrokerError ? error.code : 'CREDENTIAL_REJECTED';
      audit?.append('credential_renew_rejected', {
        code,
        message: error instanceof BrokerError ? error.message : 'The renewed credential was rejected.'
      });
      return {
        ok: false,
        error: code,
        message: error instanceof BrokerError ? error.message : 'The renewed credential was rejected.'
      };
    }
  }

  return {
    handleLine,
    async listen() {
      const dir = dirname(socketPath);
      let info;
      try {
        info = statSync(dir);
      } catch {
        throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The credential socket directory does not exist.');
      }
      if (!info.isDirectory()) {
        throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The credential socket parent is not a directory.');
      }
      if ((info.mode & 0o022) !== 0) {
        throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The credential socket directory must not be group- or world-writable.');
      }
      if (existsSync(socketPath)) rmSync(socketPath, { force: true });
      server = createServer((socket) => {
        let buffer = '';
        socket.setEncoding('utf8');
        socket.setTimeout(10000, () => socket.destroy());
        socket.on('data', async (chunk) => {
          buffer += chunk;
          if (buffer.length > MAX_LINE) {
            socket.end(JSON.stringify({ ok: false, error: 'line_too_long' }) + '\n');
            return;
          }
          const newline = buffer.indexOf('\n');
          if (newline === -1) return;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const response = await handleLine(line);
          socket.end(JSON.stringify(response) + '\n');
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          chmodSync(socketPath, mode);
          resolve();
        });
      });
      return this;
    },
    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      if (existsSync(socketPath)) rmSync(socketPath, { force: true });
      server = null;
    }
  };
}

import readline from 'node:readline';
import { QmsError, ERROR_CODES } from '../errors.js';

/** Minimal JSON-RPC client for tests, CLI tooling and future host bridges. */
export class JsonRpcConnection {
  constructor({ input, output, defaultTimeoutMs = 30_000 }) {
    this.input = input;
    this.output = output;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    this.rl = readline.createInterface({ input, crlfDelay: Infinity });
    this.rl.on('line', (line) => this._onLine(line));
    this.rl.on('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new QmsError(ERROR_CODES.HOST_PROTOCOL_ERROR, 'Host connection closed.'));
      }
      this.pending.clear();
    });
  }

  _onLine(line) {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method && message.id === undefined) {
      if (message.method === 'qms.event') {
        for (const listener of this.listeners) {
          listener(message.params);
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new QmsError(
        message.error.data?.code ?? ERROR_CODES.HOST_PROTOCOL_ERROR,
        message.error.message,
        { details: message.error.data ?? {}, retryable: message.error.data?.retryable === true }
      ));
    } else {
      pending.resolve(message.result);
    }
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(method, params = {}, { timeoutMs } = {}) {
    if (this.closed) {
      return Promise.reject(new QmsError(ERROR_CODES.HOST_PROTOCOL_ERROR, 'Host connection is closed.'));
    }
    const id = this.nextId;
    this.nextId += 1;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new QmsError(ERROR_CODES.HOST_PROTOCOL_ERROR, `Host request timed out: ${method}`, {
          details: { method, id, timeoutMs: timeout }
        }));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.output.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  close() {
    this.rl.close();
  }
}

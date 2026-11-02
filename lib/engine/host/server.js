import readline from 'node:readline';
import { QmsError, ERROR_CODES, isQmsError } from '../errors.js';

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const APPLICATION_ERROR = -32000;

function rpcError(id, code, message, data = null) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) }
  };
}

function requireProjectId(params) {
  if (!params || typeof params.projectId !== 'string' || !params.projectId) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'params.projectId is required.');
  }
  return params.projectId;
}

/**
 * JSON-RPC 2.0-style host over newline-delimited JSON (stdio or Electron IPC).
 * Presentation logic lives in the caller; this file only maps requests to the
 * engine and streams qms-event@1 notifications.
 */
export async function runHost({ engine, input = process.stdin, output = process.stdout, clock }) {
  const sessions = new Map();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  function send(message) {
    if (!closed) {
      output.write(`${JSON.stringify(message)}\n`);
    }
  }

  async function requireHandle(params, { autoOpen = true } = {}) {
    const projectId = requireProjectId(params);
    let session = sessions.get(projectId);
    if (session) {
      return session;
    }
    if (!autoOpen) {
      throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'Project is not open in this host session.', {
        details: { projectId }
      });
    }
    const handle = await engine.openProject(projectId, {
      recoverStaleLock: params.recoverStaleLock === true
    });
    session = {
      handle,
      unsubscribe: handle.events.subscribe((event) => {
        send({ jsonrpc: '2.0', method: 'qms.event', params: event });
      })
    };
    sessions.set(projectId, session);
    return session;
  }

  const methods = {
    async 'engine.info'() {
      return {
        apiVersion: engine.apiVersion,
        version: engine.version,
        dataRoot: engine.dataRoot,
        repoRoot: engine.repoRoot,
        eventSchema: 'qms-event@1',
        eventTypes: [
          'operation_started',
          'progress_updated',
          'warning_emitted',
          'operation_completed',
          'operation_failed',
          'operation_cancelled',
          'state_snapshot'
        ]
      };
    },
    async 'project.create'(params) {
      return engine.projects.create(params ?? {});
    },
    async 'project.list'(params = {}) {
      return engine.projects.list({ includeArchived: params.includeArchived === true });
    },
    async 'project.get'(params) {
      return engine.projects.get(requireProjectId(params));
    },
    async 'project.open'(params) {
      const session = await requireHandle(params);
      return {
        project: session.handle.project,
        snapshot: session.handle.snapshot()
      };
    },
    async 'project.close'(params) {
      const projectId = requireProjectId(params);
      const session = sessions.get(projectId);
      if (!session) {
        throw new QmsError(ERROR_CODES.STATE_NOT_OPEN, 'Project is not open in this host session.', {
          details: { projectId }
        });
      }
      session.unsubscribe();
      sessions.delete(projectId);
      return session.handle.close();
    },
    async 'project.update'(params) {
      const session = await requireHandle(params);
      return session.handle.update(params.patch ?? {});
    },
    async 'project.archive'(params) {
      const projectId = requireProjectId(params);
      const session = sessions.get(projectId);
      if (session) {
        session.unsubscribe();
        sessions.delete(projectId);
        await session.handle.close();
      }
      return engine.projects.archive(projectId, { deleteLocalData: params.deleteLocalData === true });
    },
    async 'project.snapshot'(params) {
      const session = await requireHandle(params);
      return session.handle.snapshot();
    },
    async 'project.validate'(params) {
      const session = await requireHandle(params);
      return session.handle.validate();
    },
    async 'state.compact'(params) {
      const session = await requireHandle(params);
      const result = await session.handle.store.compact({ reason: 'host' });
      await session.handle.events.emit({
        type: 'state_snapshot',
        phase: 'state',
        level: 'info',
        code: 'STATE_SNAPSHOT',
        message: 'Project state compacted.',
        retryable: false,
        details: result
      });
      return result;
    },
    async 'run.list'(params) {
      const session = await requireHandle(params);
      return session.handle.runs.list();
    },
    async 'run.get'(params) {
      const session = await requireHandle(params);
      return session.handle.runs.get(params.runId);
    },
    async 'run.progress'(params) {
      const session = await requireHandle(params);
      return session.handle.progress(params.runId);
    },
    async 'run.events'(params) {
      const session = await requireHandle(params);
      return session.handle.events.list({
        runId: params.runId ?? null,
        afterSeq: params.afterSeq ?? 0,
        limit: params.limit ?? 500
      });
    },
    async 'run.cancel'(params) {
      const session = await requireHandle(params, { autoOpen: false });
      return session.handle.runs.cancel(params.runId, params.reason);
    },
    async 'events.list'(params) {
      const session = await requireHandle(params);
      return session.handle.events.list({
        runId: params.runId ?? null,
        afterSeq: params.afterSeq ?? 0,
        limit: params.limit ?? 500
      });
    }
  };

  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      send(rpcError(null, INVALID_REQUEST, 'Invalid request'));
      return;
    }
    const { id, method, params } = message;
    if (typeof method !== 'string') {
      send(rpcError(id, INVALID_REQUEST, 'Request method is missing'));
      return;
    }
    const handler = methods[method];
    if (!handler) {
      send(rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`, { code: ERROR_CODES.UNKNOWN_METHOD }));
      return;
    }
    try {
      const result = await handler(params);
      if (id !== undefined && id !== null) {
        send({ jsonrpc: '2.0', id, result });
      }
    } catch (error) {
      if (isQmsError(error)) {
        send(rpcError(id, APPLICATION_ERROR, error.message, error.toJSON()));
      } else {
        send(rpcError(id, INTERNAL_ERROR, 'Internal engine error', { message: error.message }));
      }
    }
  }

  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(rpcError(null, PARSE_ERROR, 'Invalid JSON'));
      return;
    }
    // Requests are handled concurrently so run.cancel can reach a running
    // operation; state writes are serialized inside the store.
    void handleMessage(message);
  });

  const shutdown = async () => {
    if (closed) {
      return;
    }
    closed = true;
    rl.close();
    for (const session of sessions.values()) {
      session.unsubscribe();
      await session.handle.close().catch(() => {});
    }
    sessions.clear();
    resolveClosed({ closed: true });
  };

  rl.on('close', () => {
    void shutdown();
  });

  void clock;

  return { closed: closedPromise, shutdown, sessions };
}

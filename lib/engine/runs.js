import { newRunId } from './ids.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { systemClock } from './clock.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

function assertRunExists(state, runId) {
  const run = state.runs[runId];
  if (!run) {
    throw new QmsError(ERROR_CODES.OPERATION_NOT_FOUND, `Unknown operation: ${runId}`, {
      details: { runId }
    });
  }
  return run;
}

/**
 * Reconstruct progress purely from persisted events plus the run snapshot.
 * This is the contract a future GUI uses after reconnecting.
 */
export function reconstructRunProgress(state, runId) {
  const run = assertRunExists(state, runId);
  const events = Array.isArray(run.events) ? run.events : [];
  const lastProgressEvent = [...events].reverse().find((event) => event.progress) ?? null;
  const firstSeq = events[0]?.seq ?? null;
  const lastSeq = events[events.length - 1]?.seq ?? run.lastEventSeq ?? null;
  return {
    runId,
    projectId: run.projectId,
    kind: run.kind,
    state: run.state,
    phase: run.phase,
    progress: lastProgressEvent?.progress ?? run.progress ?? { completed: 0, total: 0, bytes: 0 },
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    updatedAt: run.updatedAt,
    error: run.error ?? null,
    result: run.result ?? null,
    eventCount: events.length,
    firstEventSeq: firstSeq,
    lastEventSeq: lastSeq,
    complete: TERMINAL_STATES.has(run.state),
    cancelled: run.state === 'cancelled'
  };
}

export class RunContext {
  constructor({ runId, projectId, kind, runService, controller, clock, phase }) {
    this.runId = runId;
    this.projectId = projectId;
    this.kind = kind;
    this.clock = clock;
    this.phaseName = phase;
    this.controller = controller;
    this._service = runService;
    this._terminal = false;
  }

  get signal() {
    return this.controller.signal;
  }

  get cancelled() {
    return this.controller.signal.aborted;
  }

  throwIfCancelled() {
    if (this.controller.signal.aborted) {
      throw new QmsError(ERROR_CODES.OPERATION_CANCELLED, 'Operation was cancelled.', {
        retryable: true
      });
    }
  }

  async phase(name, details = {}) {
    this.phaseName = name;
    await this._service._apply('progress_updated', {
      phase: name,
      level: 'info',
      code: 'PHASE_STARTED',
      message: `Phase started: ${name}`,
      details
    }, this, (draft) => {
      draft.runs[this.runId].phase = name;
    });
  }

  async progress(input = {}) {
    const completed = input.completed ?? 0;
    const total = input.total ?? 0;
    if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 0 || completed > total) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'progress requires integers with 0 <= completed <= total.');
    }
    const progress = {
      completed,
      total,
      bytes: input.bytes ?? 0
    };
    return this._service._apply('progress_updated', {
      phase: input.phase ?? this.phaseName,
      level: 'info',
      code: input.code ?? 'PROGRESS_UPDATED',
      message: input.message ?? `${completed} of ${total}`,
      progress,
      details: input.details ?? {}
    }, this, (draft) => {
      const run = draft.runs[this.runId];
      run.progress = progress;
      run.phase = input.phase ?? this.phaseName;
    });
  }

  async warn(code, message, details = {}) {
    return this._service._apply('warning_emitted', {
      phase: this.phaseName,
      level: 'warning',
      code,
      message,
      retryable: false,
      details
    }, this);
  }

  async complete(result = {}) {
    if (this._terminal) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Operation already finished.');
    }
    this._terminal = true;
    const endedAt = this.clock.nowIso();
    return this._service._finish(this, 'completed', {
      message: `Operation completed: ${this.kind}`,
      code: 'OPERATION_COMPLETED',
      retryable: false,
      details: { result },
      result
    }, (draft) => {
      const run = draft.runs[this.runId];
      run.state = 'completed';
      run.endedAt = endedAt;
      run.result = result;
      run.progress = { ...run.progress, completed: run.progress.total || run.progress.completed };
    });
  }

  async fail(error) {
    if (this._terminal) {
      return null;
    }
    this._terminal = true;
    const qmsError = error instanceof QmsError
      ? error
      : new QmsError(ERROR_CODES.INVALID_ARGUMENT, error instanceof Error ? error.message : String(error), {
          cause: error
        });
    const endedAt = this.clock.nowIso();
    return this._service._finish(this, 'failed', {
      message: qmsError.message,
      code: `OPERATION_FAILED`,
      level: 'error',
      retryable: qmsError.retryable,
      details: { error: qmsError.toJSON() }
    }, (draft) => {
      const run = draft.runs[this.runId];
      run.state = 'failed';
      run.endedAt = endedAt;
      run.error = qmsError.toJSON();
    });
  }

  async cancel(reason = 'Operation cancelled by user.') {
    if (this._terminal) {
      return null;
    }
    this._terminal = true;
    const endedAt = this.clock.nowIso();
    return this._service._finish(this, 'cancelled', {
      message: reason,
      code: 'OPERATION_CANCELLED',
      level: 'warning',
      retryable: true,
      details: {}
    }, (draft) => {
      const run = draft.runs[this.runId];
      run.state = 'cancelled';
      run.endedAt = endedAt;
    });
  }
}

/**
 * Runs are persisted operations with ordered qms-event@1 events.
 * One run == one user-visible long operation.
 */
export class RunService {
  constructor({ projectId, store, events, clock = systemClock, runIdFactory = newRunId, heartbeat = null }) {
    this.projectId = projectId;
    this.store = store;
    this.events = events;
    this.clock = clock;
    this.runIdFactory = runIdFactory;
    this.heartbeat = heartbeat;
    this._active = new Map();
  }

  get activeRunIds() {
    return [...this._active.keys()];
  }

  async start({ kind, phase = 'operation', meta = {} } = {}) {
    if (typeof kind !== 'string' || !kind.trim()) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'run kind is required.');
    }
    const runId = this.runIdFactory();
    const createdAt = this.clock.nowIso();
    const controller = new AbortController();
    await this.store.transaction((draft) => {
      draft.counters.run = (draft.counters.run ?? 0) + 1;
      draft.runs[runId] = {
        id: runId,
        projectId: this.projectId,
        kind,
        state: 'running',
        phase,
        createdAt,
        startedAt: createdAt,
        updatedAt: createdAt,
        endedAt: null,
        progress: { completed: 0, total: 0, bytes: 0 },
        error: null,
        result: null,
        meta,
        events: [],
        lastEventSeq: 0
      };
    });
    this._active.set(runId, controller);
    await this.events.emit([
      {
        type: 'operation_started',
        phase,
        level: 'info',
        code: 'OPERATION_STARTED',
        message: `Operation started: ${kind}`,
        retryable: false,
        details: { kind, meta }
      },
      {
        type: 'state_snapshot',
        phase: 'state',
        level: 'info',
        code: 'STATE_SNAPSHOT',
        message: 'Project state snapshot',
        retryable: false,
        details: {
          storeVersion: this.store.storeVersion,
          lastTxnSeq: this.store.lastTxnSeq,
          lastEventSeq: this.store.state.lastEventSeq,
          runId
        }
      }
    ], { runId });
    return new RunContext({
      runId,
      projectId: this.projectId,
      kind,
      runService: this,
      controller,
      clock: this.clock,
      phase
    });
  }

  async _apply(type, input, context, apply = null) {
    if (context.cancelled) {
      throw new QmsError(ERROR_CODES.OPERATION_CANCELLED, 'Operation was cancelled.', { retryable: true });
    }
    if (this.heartbeat) {
      await this.heartbeat();
    }
    return this.events.emit([{ ...input, type }], {
      runId: context.runId,
      apply: (draft) => {
        draft.runs[context.runId].updatedAt = this.clock.nowIso();
        if (apply) {
          apply(draft);
        }
      }
    });
  }

  async _finish(context, state, { message, code, level = 'info', retryable = false, details = {}, result = null }, apply) {
    this._active.delete(context.runId);
    const snapshotDetails = {
      storeVersion: this.store.storeVersion,
      lastTxnSeq: this.store.lastTxnSeq + 1,
      runId: context.runId,
      runState: state
    };
    return this.events.emit([
      {
        type: state === 'completed' ? 'operation_completed' : state === 'cancelled' ? 'operation_cancelled' : 'operation_failed',
        phase: context.phaseName,
        level,
        code,
        message,
        retryable,
        details
      },
      {
        type: 'state_snapshot',
        phase: 'state',
        level: 'info',
        code: 'STATE_SNAPSHOT',
        message: 'Project state snapshot',
        retryable: false,
        details: snapshotDetails
      }
    ], {
      runId: context.runId,
      apply: (draft) => {
        draft.runs[context.runId].updatedAt = this.clock.nowIso();
        apply(draft);
      }
    }).then((events) => ({ events, result, runId: context.runId, state }));
  }

  async cancel(runId, reason) {
    const controller = this._active.get(runId);
    if (!controller) {
      const run = this.store.state.runs[runId];
      if (!run) {
        throw new QmsError(ERROR_CODES.OPERATION_NOT_FOUND, `Unknown operation: ${runId}`);
      }
      throw new QmsError(ERROR_CODES.OPERATION_NOT_CANCELLABLE, 'Operation is not running in this engine.', {
        details: { runId, state: run.state }
      });
    }
    controller.abort(reason ?? 'cancelled');
    return { runId, cancelRequested: true };
  }

  list({ limit = 100 } = {}) {
    return Object.values(this.store.state.runs)
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
      .slice(0, limit)
      .map((run) => ({
        id: run.id,
        kind: run.kind,
        state: run.state,
        phase: run.phase,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        progress: run.progress
      }));
  }

  get(runId) {
    return reconstructRunProgress(this.store.state, runId);
  }
}

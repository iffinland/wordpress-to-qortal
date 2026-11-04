import { newEventId } from './ids.js';
import { QmsError, ERROR_CODES } from './errors.js';

export const EVENT_SCHEMA = 'qms-event@1';

/** Stable event type vocabulary for qms-event@1. */
export const EVENT_TYPES = Object.freeze([
  'operation_started',
  'progress_updated',
  'warning_emitted',
  'operation_completed',
  'operation_failed',
  'operation_cancelled',
  'state_snapshot'
]);

export const EVENT_LEVELS = Object.freeze(['debug', 'info', 'warning', 'error']);

const SECRET_KEY_PATTERN = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie)/i;
const MAX_MESSAGE_LENGTH = 500;
const MAX_DETAILS_DEPTH = 6;
const DEFAULT_LOG_LIMIT = 10_000;
const DEFAULT_RUN_EVENT_LIMIT = 5_000;

export function redact(value, depth = 0) {
  if (depth > MAX_DETAILS_DEPTH) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = redact(entry, depth + 1);
      }
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}…`;
  }
  return value;
}

export function validateEvent(event) {
  const fail = (reason) => {
    throw new QmsError(ERROR_CODES.INVALID_EVENT, `Invalid qms-event@1: ${reason}`, {
      details: { reason }
    });
  };
  if (!event || typeof event !== 'object') fail('event must be an object');
  if (event.schema !== EVENT_SCHEMA) fail('schema');
  if (!Number.isInteger(event.seq) || event.seq < 1) fail('seq');
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) fail('timestamp');
  if (typeof event.project_id !== 'string' || !event.project_id) fail('project_id');
  if (!EVENT_TYPES.includes(event.type)) fail('type');
  if (!EVENT_LEVELS.includes(event.level)) fail('level');
  if (typeof event.code !== 'string' || !/^[A-Z][A-Z0-9_.-]{1,63}$/.test(event.code)) fail('code');
  if (typeof event.message !== 'string' || event.message.length > MAX_MESSAGE_LENGTH) fail('message');
  if (event.progress !== null) {
    const { completed, total } = event.progress ?? {};
    if (!Number.isInteger(completed) || completed < 0) fail('progress.completed');
    if (!Number.isInteger(total) || total < 0) fail('progress.total');
    if (completed > total) fail('progress.completed > total');
  }
  if (typeof event.retryable !== 'boolean') fail('retryable');
  if (event.details !== null && (typeof event.details !== 'object' || Array.isArray(event.details))) fail('details');
  return event;
}

/**
 * Ordered, persisted qms-event@1 stream for one project.
 * Sequence numbers are durable across restarts because they are allocated
 * inside the same transaction that persists the event.
 */
export class EventBus {
  constructor({ projectId, store, clock, logLimit = DEFAULT_LOG_LIMIT, runEventLimit = DEFAULT_RUN_EVENT_LIMIT }) {
    this.projectId = projectId;
    this.store = store;
    this.clock = clock;
    this.logLimit = logLimit;
    this.runEventLimit = runEventLimit;
    this._subscribers = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Event listener must be a function.');
    }
    this._subscribers.add(listener);
    return () => this._subscribers.delete(listener);
  }

  _notify(events) {
    for (const event of events) {
      for (const listener of this._subscribers) {
        try {
          listener(event);
        } catch {
          // A broken listener must never break a migration operation.
        }
      }
    }
  }

  /**
   * Persist one or more events in a single transaction, then notify subscribers.
   * The caller supplies the envelope fields except schema/seq/id/timestamp.
   */
  async emit(input, { runId = null, apply = null } = {}) {
    const events = Array.isArray(input) ? input : [input];
    const { result } = await this.store.transaction((draft) => {
      const created = [];
      for (const raw of events) {
        draft.lastEventSeq += 1;
        const event = {
          schema: EVENT_SCHEMA,
          seq: draft.lastEventSeq,
          id: newEventId(),
          timestamp: this.clock.nowIso(),
          project_id: this.projectId,
          run_id: raw.runId ?? runId ?? null,
          item_id: raw.itemId ?? null,
          phase: raw.phase ?? null,
          type: raw.type,
          level: raw.level ?? 'info',
          code: raw.code,
          message: raw.message ?? '',
          progress: raw.progress ?? null,
          retryable: raw.retryable ?? false,
          details: redact(raw.details ?? {}),
          correlation_id: raw.correlationId ?? null
        };
        validateEvent(event);
        draft.events.push(event);
        if (draft.events.length > this.logLimit) {
          const removed = draft.events.length - this.logLimit;
          draft.events.splice(0, removed);
          draft.eventsDropped += removed;
        }
        if (event.run_id && draft.runs[event.run_id]) {
          const run = draft.runs[event.run_id];
          run.events = Array.isArray(run.events) ? run.events : [];
          run.events.push(event);
          if (run.events.length > this.runEventLimit) {
            run.events.splice(0, run.events.length - this.runEventLimit);
          }
          run.lastEventSeq = event.seq;
        }
        created.push(event);
      }
      if (apply) {
        apply(draft);
      }
      return created;
    });
    this._notify(result);
    return result;
  }

  /** Read persisted events, optionally for one run and after a sequence. */
  list({ runId = null, afterSeq = 0, limit = 500 } = {}) {
    const source = runId
      ? this.store.state.runs[runId]?.events ?? []
      : this.store.state.events;
    return source.filter((event) => event.seq > afterSeq).slice(0, limit);
  }
}

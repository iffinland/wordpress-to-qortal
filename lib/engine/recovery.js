import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, readJsonIfExists } from './storage/atomic.js';
import { assertPathInside } from './storage/paths.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { verifyResources } from './publication/remote.js';

/**
 * Phase 8 crash-safe recovery.
 *
 * Every long-running operation owns a durable checkpoint file under
 * <project>/recovery/runs/<runId>.json. The file is written atomically at
 * phase and step boundaries, so a killed process, power loss or disk error
 * leaves either the previous or the next complete checkpoint - never a
 * half-written one.
 *
 * Recovery deliberately separates three outcomes:
 *   - resumable: the operation can be re-driven idempotently;
 *   - interrupted: the run stopped but has no safe automatic continuation;
 *   - ambiguous: a publication submission happened but its result is unknown.
 * Ambiguous publications are never submitted again automatically; they must be
 * reconciled against an exact QDN read-back.
 */
export const RECOVERY_CHECKPOINT_SCHEMA = 'qms-recovery-checkpoint@1';
export const RECOVERY_STAGE_SCHEMA = 'qms-recovery-stage@1';
export const RECOVERY_STATUS_SCHEMA = 'qms-recovery-status@1';
export const RECOVERY_CHECKPOINT_VERSION = 1;
export const MAX_CHECKPOINT_STEPS = 200;
export const MAX_STATUS_ITEMS = 500;

const RESUMABLE_KINDS = Object.freeze([
  'source.discover',
  'plan.create',
  'media.download',
  'publication.verify',
  'sync.check'
]);

const RESUME_ACTIONS = Object.freeze({
  'source.discover': { service: 'source', method: 'discover' },
  'plan.create': { service: 'planning', method: 'create' },
  'media.download': { service: 'media', method: 'download' },
  'publication.verify': { service: 'publication', method: 'verify' },
  'sync.check': { service: 'sync', method: 'resume' }
});

const RUN_STATES = Object.freeze([
  'running', 'completed', 'failed', 'cancelled', 'paused', 'interrupted', 'resumed', 'abandoned'
]);

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stagePath(paths, stageId) {
  if (typeof stageId !== 'string' || !/^stg_[a-z0-9_-]{4,80}$/.test(stageId)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid recovery stage id: ' + String(stageId));
  }
  return assertPathInside(paths.recoveryStagesDir, path.join(paths.recoveryStagesDir, stageId + '.json'), 'recovery stage');
}

export function checkpointPath(paths, runId) {
  if (typeof runId !== 'string' || !/^run_[a-z0-9]{8,40}$/.test(runId)) {
    fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid run id: ' + String(runId));
  }
  return assertPathInside(paths.recoveryRunsDir, path.join(paths.recoveryRunsDir, runId + '.json'), 'recovery checkpoint');
}

function emptyCheckpoint({ projectId, runId, kind, phase, meta, clock }) {
  const now = clock.nowIso();
  return {
    schema: RECOVERY_CHECKPOINT_SCHEMA,
    version: RECOVERY_CHECKPOINT_VERSION,
    projectId,
    runId,
    kind,
    phase,
    step: phase,
    cursor: 0,
    total: 0,
    status: 'running',
    resumable: false,
    resume: null,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    heartbeatAt: now,
    pid: process.pid,
    meta: meta ?? {},
    steps: [],
    details: {}
  };
}

export class RecoveryService {
  constructor({ projectId, paths, store, clock, events = null, history = null, getHandlers = null, onCheckpoint = null }) {
    this.projectId = projectId;
    this.paths = paths;
    this.store = store;
    this.clock = clock;
    this.events = events;
    this.history = history;
    this.getHandlers = getHandlers;
    this.onCheckpoint = onCheckpoint;
    this._recovered = null;
    this._writeChain = Promise.resolve();
  }

  _serialize(fn) {
    const previous = this._writeChain;
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this._writeChain = previous.then(() => current);
    return previous.then(fn).finally(release);
  }

  async _write(record, { notify = true } = {}) {
    await mkdir(this.paths.recoveryRunsDir, { recursive: true, mode: 0o700 });
    record.updatedAt = this.clock.nowIso();
    record.heartbeatAt = record.updatedAt;
    record.steps = (record.steps ?? []).slice(-MAX_CHECKPOINT_STEPS);
    await atomicWriteJson(checkpointPath(this.paths, record.runId), record, { mode: 0o600 });
    if (notify && typeof this.onCheckpoint === 'function') {
      await this.onCheckpoint({ ...record });
    }
    return record;
  }

  async readCheckpoint(runId) {
    const file = checkpointPath(this.paths, runId);
    let raw;
    try {
      raw = await readJsonIfExists(file);
    } catch (error) {
      return { corrupt: true, runId, file, error: error.message };
    }
    if (!raw) return null;
    if (raw.schema !== RECOVERY_CHECKPOINT_SCHEMA || raw.runId !== runId) {
      return { corrupt: true, runId, file, error: 'checkpoint schema or run id mismatch' };
    }
    return raw;
  }

  // ---- Stage checkpoints -------------------------------------------------
  // Some operations (handoff preparation, receipt import, read-back
  // verification) are not RunService operations. They still get a durable
  // journal file so a crash is never silent.

  async readStage(stageId) {
    const file = stagePath(this.paths, stageId);
    let raw;
    try {
      raw = await readJsonIfExists(file);
    } catch (error) {
      return { corrupt: true, stageId, file, error: error.message };
    }
    if (!raw) return null;
    if (raw.schema !== RECOVERY_STAGE_SCHEMA || raw.stageId !== stageId) {
      return { corrupt: true, stageId, file, error: 'stage schema or id mismatch' };
    }
    return raw;
  }

  async _writeStage(record) {
    await mkdir(this.paths.recoveryStagesDir, { recursive: true, mode: 0o700 });
    record.updatedAt = this.clock.nowIso();
    record.heartbeatAt = record.updatedAt;
    record.steps = (record.steps ?? []).slice(-MAX_CHECKPOINT_STEPS);
    await atomicWriteJson(stagePath(this.paths, record.stageId), record, { mode: 0o600 });
    if (typeof this.onCheckpoint === 'function') {
      await this.onCheckpoint({ ...record });
    }
    return record;
  }

  async stageCheckpoint({ stageId, kind, phase = null, step = null, cursor = 0, total = 0, resumable = false, resume = null, details = {} }) {
    const existing = await this.readStage(stageId);
    const now = this.clock.nowIso();
    const record = existing && !existing.corrupt
      ? existing
      : {
          schema: RECOVERY_STAGE_SCHEMA,
          version: 1,
          projectId: this.projectId,
          stageId,
          kind,
          createdAt: now,
          steps: []
        };
    record.kind = kind ?? record.kind;
    record.phase = phase ?? record.phase ?? null;
    record.step = step ?? phase ?? record.step ?? null;
    record.cursor = Number.isInteger(cursor) ? cursor : record.cursor ?? 0;
    record.total = Number.isInteger(total) ? total : record.total ?? 0;
    record.resumable = resumable === true;
    record.resume = resume ?? null;
    record.status = 'running';
    record.pid = process.pid;
    record.details = { ...(record.details ?? {}), ...details };
    record.steps = [...(record.steps ?? []), {
      step: record.step,
      phase: record.phase,
      at: now,
      cursor: record.cursor,
      total: record.total
    }];
    return this._writeStage(record);
  }

  async stageComplete(stageId, { status = 'completed', details = {} } = {}) {
    const existing = await this.readStage(stageId);
    if (!existing || existing.corrupt) return null;
    return this._writeStage({
      ...existing,
      status,
      resumable: false,
      resume: null,
      completedAt: this.clock.nowIso(),
      details: { ...(existing.details ?? {}), ...details }
    });
  }

  async listStages() {
    const out = [];
    try {
      const files = await readdir(this.paths.recoveryStagesDir);
      for (const file of files.filter((entry) => entry.endsWith('.json'))) {
        const stageId = file.slice(0, -'.json'.length);
        if (!/^stg_[a-z0-9_-]{4,80}$/.test(stageId)) continue;
        const stage = await this.readStage(stageId);
        if (stage?.corrupt) {
          out.push({ corrupt: true, stageId, file: stage.file, error: stage.error });
        } else if (stage) {
          out.push(stage);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return out.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  /** Called by RunService.start. */
  async onRunStart({ runId, kind, phase, meta }) {
    const record = emptyCheckpoint({
      projectId: this.projectId,
      runId,
      kind,
      phase,
      meta,
      clock: this.clock
    });
    await this._write(record, { notify: false });
    if (this.history) {
      await this.history.record({
        type: 'run_started',
        runId,
        status: 'running',
        details: { kind, phase }
      }).catch(() => {});
    }
    return record;
  }

  /** Called by RunContext.checkpoint at durable step boundaries. */
  async onRunCheckpoint({ runId, kind, phase, step, cursor, total, resumable, resume, details = {} }) {
    const existing = await this.readCheckpoint(runId);
    const record = existing && !existing.corrupt
      ? existing
      : emptyCheckpoint({ projectId: this.projectId, runId, kind, phase, meta: {}, clock: this.clock });
    record.phase = phase ?? record.phase;
    record.step = step ?? phase ?? record.step;
    record.cursor = Number.isInteger(cursor) ? cursor : record.cursor;
    record.total = Number.isInteger(total) ? total : record.total;
    if (resumable !== undefined) record.resumable = resumable === true;
    if (resume !== undefined) record.resume = resume ?? null;
    record.status = 'running';
    record.details = { ...(record.details ?? {}), ...details };
    record.steps = [...(record.steps ?? []), {
      step: record.step,
      phase: record.phase,
      at: this.clock.nowIso(),
      cursor: record.cursor,
      total: record.total
    }];
    return this._write(record);
  }

  /** Called by RunContext.complete/fail/cancel/pause. */
  async onRunFinish({ runId, kind, state, error = null, result = null }) {
    if (runId === undefined || runId === null) return null;
    const existing = await this.readCheckpoint(runId);
    const record = existing && !existing.corrupt
      ? existing
      : emptyCheckpoint({ projectId: this.projectId, runId, kind, phase: state, meta: {}, clock: this.clock });
    record.status = state;
    if (state === 'completed' || state === 'cancelled' || state === 'failed') {
      record.resumable = false;
      record.resume = null;
    }
    if (error) record.error = error;
    if (result) record.resultSummary = result;
    return this._write(record, { notify: false });
  }


  /**
   * Run once when a project is opened.
   * 1. Persisted runs that are still marked running cannot have a live owner
   *    (the project lock is held by this process), so they become interrupted.
   * 2. Submitted resources without any receipt/verification evidence become
   *    ambiguous instead of being silently retried.
   */
  async recoverOnOpen() {
    if (this._recovered) return this._recovered;
    const interrupted = [];
    const ambiguous = [];
    const corrupt = [];

    const running = Object.values(this.store.state.runs ?? {})
      .filter((run) => run.state === 'running');
    for (const run of running) {
      const checkpoint = await this.readCheckpoint(run.id);
      if (checkpoint?.corrupt) {
        corrupt.push({ runId: run.id, file: checkpoint.file, error: checkpoint.error });
      }
      const resumable = checkpoint && !checkpoint.corrupt && checkpoint.resumable === true && checkpoint.resume;
      const now = this.clock.nowIso();
      await this.store.transaction((draft) => {
        const target = draft.runs[run.id];
        if (!target) return;
        target.state = 'interrupted';
        target.endedAt = now;
        target.updatedAt = now;
        target.interruptedAt = now;
        target.interruption = {
          reason: 'PROCESS_EXITED_WHILE_RUNNING',
          resumable: Boolean(resumable),
          checkpoint: checkpoint && !checkpoint.corrupt
            ? { step: checkpoint.step ?? null, phase: checkpoint.phase ?? null, cursor: checkpoint.cursor ?? 0, total: checkpoint.total ?? 0 }
            : null
        };
      });
      if (checkpoint && !checkpoint.corrupt) {
        await this._write({
          ...checkpoint,
          status: 'interrupted',
          resumable: Boolean(resumable),
          interruptedAt: now,
          details: { ...(checkpoint.details ?? {}), interruptionReason: 'PROCESS_EXITED_WHILE_RUNNING' }
        });
      }
      interrupted.push({
        runId: run.id,
        kind: run.kind,
        phase: checkpoint && !checkpoint.corrupt ? checkpoint.phase : run.phase,
        step: checkpoint && !checkpoint.corrupt ? checkpoint.step : null,
        cursor: checkpoint && !checkpoint.corrupt ? checkpoint.cursor : 0,
        total: checkpoint && !checkpoint.corrupt ? checkpoint.total : 0,
        resumable: Boolean(resumable),
        reason: 'PROCESS_EXITED_WHILE_RUNNING'
      });
      if (this.history) {
        await this.history.record({
          type: 'run_interrupted',
          runId: run.id,
          status: 'interrupted',
          details: { kind: run.kind, resumable: Boolean(resumable) }
        }).catch(() => {});
      }
    }

    const publication = this.store.state.publication ?? {};
    const resources = Object.values(publication.resources ?? {});
    const submitted = resources.filter((resource) => resource.status === 'submitted');
    if (submitted.length > 0) {
      const now = this.clock.nowIso();
      await this.store.transaction((draft) => {
        const state = draft.publication;
        const touchedHandoffs = new Set();
        for (const resource of submitted) {
          const stored = state.resources[resource.id];
          if (!stored || stored.status !== 'submitted') continue;
          stored.status = 'ambiguous';
          stored.state = 'ambiguous';
          stored.reason = 'INTERRUPTED_BEFORE_RECEIPT: submission state is unknown. Reconcile with an exact QDN read-back; do not resubmit.';
          stored.updatedAt = now;
          stored.requiresReconciliation = true;
          stored.evidence = {
            ...(stored.evidence ?? {}),
            ambiguousAt: now,
            ambiguityReason: 'INTERRUPTED_BEFORE_RECEIPT'
          };
          touchedHandoffs.add(stored.handoffId);
          ambiguous.push({
            handoffId: stored.handoffId,
            resourceId: stored.id,
            service: stored.service,
            name: stored.name,
            identifier: stored.identifier,
            sha256: stored.sha256 ?? null,
            bytes: stored.bytes ?? null,
            status: 'ambiguous',
            reason: stored.reason
          });
        }
        for (const handoffId of touchedHandoffs) {
          const handoff = state.handoffs[handoffId];
          if (!handoff) continue;
          if (handoff.resources.some((resource) => resource.status === 'submitted')) {
            handoff.resources = handoff.resources.map((resource) => (
              resource.status === 'submitted'
                ? { ...resource, status: 'ambiguous', updatedAt: now, requiresReconciliation: true }
                : resource
            ));
          }
          handoff.status = 'ambiguous';
          handoff.updatedAt = now;
          state.plans[handoff.publicationBatchId] = {
            ...(state.plans[handoff.publicationBatchId] ?? {}),
            status: 'ambiguous',
            updatedAt: now
          };
        }
        if (touchedHandoffs.size > 0) {
          state.history.unshift({
            type: 'publication_reconciliation_required',
            at: now,
            handoffIds: [...touchedHandoffs],
            resources: submitted.length
          });
          state.history = state.history.slice(0, 1000);
          state.revision += 1;
        }
      });
      if (this.history) {
        for (const entry of ambiguous) {
          await this.history.record({
            type: 'publication_ambiguous',
            handoffId: entry.handoffId,
            resourceId: entry.resourceId,
            contentHash: entry.sha256,
            bytes: entry.bytes,
            status: 'ambiguous',
            details: { reason: 'INTERRUPTED_BEFORE_RECEIPT', identifier: entry.identifier }
          }).catch(() => {});
        }
      }
    }

    for (const entry of corrupt) {
      if (this.history) {
        await this.history.record({
          type: 'checkpoint_corrupt',
          runId: entry.runId,
          status: 'corrupt',
          details: { file: entry.file, error: entry.error }
        }).catch(() => {});
      }
    }

    const interruptedStages = [];
    for (const stage of await this.listStages()) {
      if (stage.corrupt) {
        corrupt.push({ stageId: stage.stageId, file: stage.file, error: stage.error });
        if (this.history) {
          await this.history.record({
            type: 'checkpoint_corrupt',
            status: 'corrupt',
            details: { stageId: stage.stageId, file: stage.file, error: stage.error }
          }).catch(() => {});
        }
        continue;
      }
      if (stage.status !== 'running' || stage.pid === process.pid) continue;
      const updated = await this._writeStage({
        ...stage,
        status: 'interrupted',
        interruptedAt: this.clock.nowIso(),
        details: { ...(stage.details ?? {}), interruptionReason: 'PROCESS_EXITED_WHILE_RUNNING' }
      });
      interruptedStages.push({
        stageId: updated.stageId,
        kind: updated.kind,
        phase: updated.phase ?? null,
        step: updated.step ?? null,
        cursor: updated.cursor ?? 0,
        total: updated.total ?? 0,
        resumable: updated.resumable === true && Boolean(updated.resume)
      });
      if (this.history) {
        await this.history.record({
          type: 'run_interrupted',
          status: 'interrupted',
          details: { stageId: updated.stageId, kind: updated.kind, resumable: updated.resumable === true }
        }).catch(() => {});
      }
    }

    this._recovered = {
      schema: RECOVERY_STATUS_SCHEMA,
      projectId: this.projectId,
      recoveredAt: this.clock.nowIso(),
      interruptedRuns: interrupted,
      interruptedStages,
      ambiguousResources: ambiguous,
      corruptCheckpoints: corrupt
    };
    return this._recovered;
  }

  async status() {
    await this.recoverOnOpen().catch(() => {});
    const runs = Object.values(this.store.state.runs ?? {});
    const candidates = [];
    for (const run of runs) {
      if (!['interrupted', 'paused', 'failed'].includes(run.state)) continue;
      const checkpoint = await this.readCheckpoint(run.id);
      const resumable = Boolean(checkpoint && !checkpoint.corrupt && checkpoint.resumable && checkpoint.resume);
      candidates.push({
        runId: run.id,
        kind: run.kind,
        state: run.state,
        phase: checkpoint && !checkpoint.corrupt ? checkpoint.phase : run.phase,
        step: checkpoint && !checkpoint.corrupt ? checkpoint.step : null,
        cursor: checkpoint && !checkpoint.corrupt ? checkpoint.cursor : 0,
        total: checkpoint && !checkpoint.corrupt ? checkpoint.total : 0,
        resumable,
        action: resumable ? checkpoint.resume : null,
        resumeHint: resumable
          ? 'Resume re-runs the operation idempotently from the last durable checkpoint.'
          : 'This operation cannot be resumed automatically. Retry it from the relevant screen.',
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        error: run.error ?? null
      });
    }
    for (const stage of await this.listStages()) {
      if (stage.corrupt || !['interrupted', 'running', 'failed'].includes(stage.status)) continue;
      if (stage.pid === process.pid) continue;
      const resumable = stage.resumable === true && Boolean(stage.resume);
      candidates.push({
        stageId: stage.stageId,
        runId: null,
        kind: stage.kind,
        state: stage.status,
        phase: stage.phase ?? null,
        step: stage.step ?? null,
        cursor: stage.cursor ?? 0,
        total: stage.total ?? 0,
        resumable,
        action: resumable ? stage.resume : null,
        resumeHint: resumable
          ? 'Resume re-runs the step idempotently from the last durable checkpoint.'
          : 'This step cannot be resumed automatically. Retry it from the relevant screen.',
        startedAt: stage.createdAt ?? null,
        endedAt: stage.updatedAt ?? null,
        error: null
      });
    }
    const publication = this.store.state.publication ?? {};
    const ambiguousResources = Object.values(publication.resources ?? {})
      .filter((resource) => resource.status === 'ambiguous')
      .map((resource) => ({
        handoffId: resource.handoffId,
        resourceId: resource.id,
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        sha256: resource.sha256 ?? null,
        bytes: resource.bytes ?? null,
        reason: resource.reason ?? null,
        txSignature: resource.txSignature ?? null,
        requiresReconciliation: true
      }));
    const corruptCheckpoints = [];
    try {
      const files = await readdir(this.paths.recoveryRunsDir);
      for (const file of files.filter((entry) => entry.endsWith('.json'))) {
        const runId = file.slice(0, -'.json'.length);
        const checkpoint = await this.readCheckpoint(runId);
        if (checkpoint?.corrupt) corruptCheckpoints.push({ runId, file: checkpoint.file, error: checkpoint.error });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const stage of await this.listStages()) {
      if (stage.corrupt) corruptCheckpoints.push({ stageId: stage.stageId, file: stage.file, error: stage.error });
    }
    const cleanups = Object.values(this.store.state.recovery?.cleanups ?? {})
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, MAX_STATUS_ITEMS)
      .map((record) => ({
        cleanupId: record.cleanupId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        restoreBy: record.restoreBy ?? null,
        files: record.fileCount ?? 0,
        bytesQuarantined: record.bytesQuarantined ?? 0,
        bytesReclaimed: record.bytesReclaimed ?? 0
      }));
    return {
      schema: RECOVERY_STATUS_SCHEMA,
      projectId: this.projectId,
      checkedAt: this.clock.nowIso(),
      recovery: {
        interruptedRuns: candidates.length,
        resumableRuns: candidates.filter((entry) => entry.resumable).length,
        interruptedStages: candidates.filter((entry) => entry.stageId).length,
        ambiguousResources: ambiguousResources.length,
        corruptCheckpoints: corruptCheckpoints.length
      },
      candidates: candidates.slice(0, MAX_STATUS_ITEMS),
      ambiguousResources: ambiguousResources.slice(0, MAX_STATUS_ITEMS),
      corruptCheckpoints,
      cleanups
    };
  }

  async _requireCandidate(runId) {
    if (typeof runId === 'string' && runId.startsWith('stg_')) {
      const stage = await this.readStage(runId);
      if (!stage || stage.corrupt) {
        fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'No usable recovery checkpoint exists for this step.', { stageId: runId });
      }
      if (!stage.resume || stage.resumable !== true || stage.pid === process.pid) {
        fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'This step has no safe automatic continuation.', { stageId: runId, kind: stage.kind });
      }
      return {
        run: { id: null, kind: stage.kind, state: stage.status, meta: stage.details ?? {} },
        checkpoint: { ...stage, runId: null }
      };
    }
    const run = this.store.state.runs?.[runId];
    if (!run) {
      fail(ERROR_CODES.OPERATION_NOT_FOUND, 'Unknown operation: ' + String(runId), { runId });
    }
    if (run.state === 'running') {
      fail(ERROR_CODES.OPERATION_NOT_CANCELLABLE, 'The operation is still running; pause or cancel it first.', { runId });
    }
    const checkpoint = await this.readCheckpoint(runId);
    if (!checkpoint || checkpoint.corrupt) {
      fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'No usable recovery checkpoint exists for this operation.', { runId });
    }
    if (!checkpoint.resume || !checkpoint.resumable) {
      fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'This operation has no safe automatic continuation.', { runId, kind: run.kind });
    }
    return { run, checkpoint };
  }

  /** Resume an interrupted operation through an idempotent re-drive. */
  async resume(runId, overrides = {}) {
    const isStage = typeof runId === 'string' && runId.startsWith('stg_');
    const { run, checkpoint } = await this._requireCandidate(runId);
    if (!this.getHandlers) {
      fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'Recovery handlers are unavailable in this process.', { runId });
    }
    const handlers = this.getHandlers();
    const action = checkpoint.resume;
    const service = handlers?.[action.service];
    const method = service?.[action.method];
    if (typeof method !== 'function') {
      fail(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'The resume target is unavailable.', {
        runId,
        action
      });
    }
    const resumeNote = {
      runId,
      kind: run.kind,
      step: checkpoint.step,
      cursor: checkpoint.cursor,
      resumedAt: this.clock.nowIso()
    };
    let result;
    try {
      result = await method.call(service, { ...(action.params ?? {}), ...(overrides ?? {}) });
    } catch (error) {
      await this.store.transaction((draft) => {
        const target = draft.runs[runId];
        if (target) {
          target.recovery = { ...(target.recovery ?? {}), lastResumeError: { code: error.code ?? 'ERROR', message: error.message }, lastResumeAt: this.clock.nowIso() };
        }
      });
      throw error;
    }
    if (isStage) {
      await this._writeStage({
        ...checkpoint,
        schema: RECOVERY_STAGE_SCHEMA,
        stageId: runId,
        status: 'resumed',
        resumable: false,
        resume: null,
        resumedAt: this.clock.nowIso(),
        resumeResult: result?.runId ?? null
      });
    } else {
      await this.store.transaction((draft) => {
        const target = draft.runs[runId];
        if (target) {
          target.state = 'resumed';
          target.resumedAt = this.clock.nowIso();
          target.recovery = { ...(target.recovery ?? {}), resumedAt: this.clock.nowIso(), resumeResult: result?.runId ?? null };
        }
      });
      await this._write({
        ...checkpoint,
        status: 'resumed',
        resumable: false,
        resumedAt: this.clock.nowIso(),
        resumeResult: result?.runId ?? null
      });
    }
    if (this.history) {
      await this.history.record({
        type: 'run_resumed',
        runId: isStage ? null : runId,
        status: 'resumed',
        details: { stageId: isStage ? runId : null, kind: run.kind, step: checkpoint.step, newRunId: result?.runId ?? null }
      }).catch(() => {});
    }
    return {
      runId: isStage ? null : runId,
      stageId: isStage ? runId : null,
      state: 'resumed',
      resumedFrom: resumeNote,
      result
    };
  }

  async dismiss(runId, { reason = 'Dismissed by operator.' } = {}) {
    const run = this.store.state.runs?.[runId];
    if (!run) fail(ERROR_CODES.OPERATION_NOT_FOUND, 'Unknown operation: ' + String(runId), { runId });
    if (run.state === 'running') {
      fail(ERROR_CODES.OPERATION_NOT_CANCELLABLE, 'Cancel the running operation before dismissing it.', { runId });
    }
    await this.store.transaction((draft) => {
      const target = draft.runs[runId];
      if (!target) return;
      target.state = 'abandoned';
      target.abandonedAt = this.clock.nowIso();
      target.abandonReason = reason;
    });
    const checkpoint = await this.readCheckpoint(runId);
    if (checkpoint && !checkpoint.corrupt) {
      await this._write({ ...checkpoint, status: 'abandoned', resumable: false, resume: null });
    }
    if (this.history) {
      await this.history.record({
        type: 'run_dismissed',
        runId,
        status: 'abandoned',
        details: { reason, kind: run.kind }
      }).catch(() => {});
    }
    return { runId, state: 'abandoned' };
  }

  /**
   * Reconcile ambiguous publication state against exact QDN read-back.
   * This never submits, signs or retries a publication.
   */
  async reconcilePublication({ handoffId = null, nodeUrl, attempts = 3, intervalMs = 0 } = {}) {
    if (!this.getHandlers) {
      fail(ERROR_CODES.RECOVERY_RECONCILIATION_FAILED, 'Publication handlers are unavailable in this process.');
    }
    const publication = this.store.state.publication ?? {};
    const resources = Object.values(publication.resources ?? {}).filter((resource) => (
      resource.status === 'ambiguous' && (handoffId === null || resource.handoffId === handoffId)
    ));
    if (resources.length === 0) {
      return {
        schema: RECOVERY_STATUS_SCHEMA,
        handoffId,
        reconciled: 0,
        verified: 0,
        stillAmbiguous: 0,
        resubmitted: false,
        message: 'No ambiguous publication resources to reconcile.'
      };
    }
    const verification = await verifyResources({
      fetchImpl: this.getHandlers().fetchImpl ?? globalThis.fetch,
      nodeUrl,
      resources: resources.map((resource) => ({
        id: resource.id,
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        bytes: resource.bytes,
        sha256: resource.sha256
      })),
      attempts,
      intervalMs,
      timeoutMs: 30000
    });
    const byId = new Map(verification.results.map((result) => [result.resourceId, result]));
    const now = this.clock.nowIso();
    const verified = [];
    const stillAmbiguous = [];
    await this.store.transaction((draft) => {
      const state = draft.publication;
      const touched = new Set();
      for (const resource of resources) {
        const stored = state.resources[resource.id];
        if (!stored) continue;
        const result = byId.get(resource.id);
        const exact = result?.state === 'remote_verified';
        stored.evidence = {
          ...(stored.evidence ?? {}),
          reconciledAt: now,
          reconciliation: {
            state: result?.state ?? 'unavailable',
            code: result?.code ?? null,
            exact,
            checkedAt: now,
            nodeUrl: verification.nodeUrl
          }
        };
        if (exact) {
          stored.status = 'remote_verified';
          stored.state = 'remote_verified';
          stored.reason = null;
          stored.requiresReconciliation = false;
          stored.verifiedAt = now;
          stored.verification = result;
          stored.updatedAt = now;
          verified.push({ resourceId: resource.id, handoffId: stored.handoffId });
        } else {
          stored.status = 'ambiguous';
          stored.state = 'ambiguous';
          stored.reason = 'RECONCILIATION_INCONCLUSIVE: ' + (result?.message ?? 'Remote bytes could not be verified.');
          stored.requiresReconciliation = true;
          stored.updatedAt = now;
          stillAmbiguous.push({ resourceId: resource.id, handoffId: stored.handoffId, state: result?.state ?? null, code: result?.code ?? null });
        }
        touched.add(stored.handoffId);
        const handoff = state.handoffs[stored.handoffId];
        if (handoff) {
          handoff.resources = handoff.resources.map((entry) => (
            entry.id === resource.id
              ? {
                  ...entry,
                  status: exact ? 'remote_verified' : 'ambiguous',
                  updatedAt: now,
                  requiresReconciliation: !exact
                }
              : entry
          ));
          handoff.updatedAt = now;
          const allVerified = handoff.resources.every((entry) => entry.status === 'remote_verified');
          handoff.status = allVerified ? 'remote_verified' : 'ambiguous';
          state.plans[handoff.publicationBatchId] = {
            ...(state.plans[handoff.publicationBatchId] ?? {}),
            status: handoff.status,
            updatedAt: now
          };
        }
      }
      state.history.unshift({
        type: 'publication_reconciled',
        at: now,
        handoffIds: [...touched],
        verified: verified.length,
        stillAmbiguous: stillAmbiguous.length,
        resubmitted: false
      });
      state.history = state.history.slice(0, 1000);
      state.revision += 1;
    });
    if (this.history) {
      for (const entry of verified) {
        const resource = resources.find((candidate) => candidate.id === entry.resourceId);
        await this.history.record({
          type: 'publication_reconciled',
          handoffId: entry.handoffId,
          resourceId: entry.resourceId,
          status: 'remote_verified',
          contentHash: resource?.sha256 ?? null,
          bytes: resource?.bytes ?? null,
          txSignature: resource?.txSignature ?? null,
          details: { exact: true }
        }).catch(() => {});
      }
    }
    return {
      schema: RECOVERY_STATUS_SCHEMA,
      handoffId,
      reconciled: resources.length,
      verified: verified.length,
      stillAmbiguous: stillAmbiguous.length,
      resubmitted: false,
      nodeUrl: verification.nodeUrl,
      results: verification.results,
      message: 'Ambiguous resources were checked with exact QDN read-back only. Nothing was resubmitted.'
    };
  }
}


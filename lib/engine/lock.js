import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, fsyncDirectory } from './storage/atomic.js';
import { newLockToken } from './ids.js';
import { QmsError, ERROR_CODES } from './errors.js';
import { systemClock } from './clock.js';

export const LOCK_SCHEMA = 'qms-lock@1';
export const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function readLockFile(file) {
  try {
    const raw = await readFile(file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      return { corrupt: true, raw };
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Exclusive per-project writer lock.
 *
 * - Creation uses O_EXCL so two processes cannot both win.
 * - A lock whose owner process is gone, or whose heartbeat expired, is stale.
 * - Stale locks are never taken over implicitly; the caller must pass
 *   recoverStale=true (CLI: --recover-stale), and the old lock is archived.
 */
export class ProjectLock {
  constructor(options) {
    this.file = options.file;
    this.projectId = options.projectId;
    this.token = options.token;
    this.pid = options.pid;
    this.hostname = options.hostname;
    this.clock = options.clock ?? systemClock;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.acquiredAt = options.acquiredAt;
    this.lastHeartbeatMs = options.lastHeartbeatMs;
    this.released = false;
    this.recoveredStaleLock = options.recoveredStaleLock ?? false;
  }

  static async acquire(options = {}) {
    const file = options.file;
    if (!file) {
      throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'ProjectLock.acquire requires a file.');
    }
    const clock = options.clock ?? systemClock;
    const hostname = options.hostname ?? os.hostname();
    const pid = options.pid ?? process.pid;
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const recoverStale = options.recoverStale === true;

    await mkdir(path.dirname(file), { recursive: true });
    await fsyncDirectory(path.dirname(file)); // ensure the parent is durable

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = newLockToken();
      const now = clock.nowIso();
      const record = {
        schema: LOCK_SCHEMA,
        projectId: options.projectId ?? null,
        token,
        pid,
        hostname,
        acquiredAt: now,
        heartbeatAt: now,
        engine: options.engineVersion ?? null
      };
      let handle;
      try {
        handle = await open(file, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
        const existing = await readLockFile(file);
        const staleReason = ProjectLock.staleReason(existing, {
          nowMs: clock.nowMs(),
          staleAfterMs,
          hostname
        });

        if (!staleReason) {
          throw new QmsError(
            ERROR_CODES.PROJECT_LOCKED,
            'Project is locked by another process.',
            {
              details: {
                projectId: options.projectId ?? null,
                owner: existing
                  ? {
                      pid: existing.pid,
                      hostname: existing.hostname,
                      acquiredAt: existing.acquiredAt,
                      heartbeatAt: existing.heartbeatAt
                    }
                  : null
              }
            }
          );
        }
        if (existing?.corrupt) {
          throw new QmsError(
            ERROR_CODES.PROJECT_LOCK_CORRUPT,
            'Project lock file is corrupt; explicit recovery is required.',
            { details: { file, reason: staleReason } }
          );
        }
        if (!recoverStale) {
          throw new QmsError(
            ERROR_CODES.PROJECT_LOCK_STALE,
            `Project lock is stale (${staleReason}). Re-run with explicit stale-lock recovery.`,
            {
              details: {
                projectId: options.projectId ?? null,
                reason: staleReason,
                owner: existing
                  ? { pid: existing.pid, hostname: existing.hostname, heartbeatAt: existing.heartbeatAt }
                  : null
              }
            }
          );
        }

        const archived = `${file}.stale-${Date.now()}`;
        try {
          await rename(file, archived);
        } catch (renameError) {
          if (renameError.code === 'ENOENT') {
            continue; // someone else recovered it; retry the exclusive create
          }
          throw renameError;
        }
        const lock = await ProjectLock.acquire({ ...options, recoverStale: false });
        lock.recoveredStaleLock = true;
        lock.archivedStaleLock = archived;
        return lock;
      }

      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsyncDirectory(path.dirname(file));

      return new ProjectLock({
        file,
        projectId: record.projectId,
        token,
        pid,
        hostname,
        clock,
        staleAfterMs,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        acquiredAt: record.acquiredAt,
        lastHeartbeatMs: clock.nowMs()
      });
    }

    throw new QmsError(ERROR_CODES.PROJECT_LOCKED, 'Could not acquire project lock after retries.');
  }

  static staleReason(existing, { nowMs, staleAfterMs, hostname }) {
    if (!existing) {
      return null;
    }
    if (existing.corrupt || typeof existing.token !== 'string') {
      return 'corrupt-lock-file';
    }
    const heartbeatMs = Date.parse(existing.heartbeatAt);
    if (!Number.isFinite(heartbeatMs)) {
      return 'invalid-heartbeat';
    }
    const sameHost = existing.hostname === hostname;
    const alive = sameHost ? isProcessAlive(existing.pid) : null;
    if (sameHost && alive) {
      if (nowMs - heartbeatMs > staleAfterMs) {
        return 'heartbeat-expired';
      }
      return null;
    }
    if (sameHost && !alive) {
      return 'owner-process-gone';
    }
    if (nowMs - heartbeatMs > staleAfterMs) {
      return 'heartbeat-expired';
    }
    return null;
  }

  async readInfo() {
    return readLockFile(this.file);
  }

  async assertHeld() {
    const info = await readLockFile(this.file);
    if (!info || info.corrupt || info.token !== this.token || info.pid !== this.pid) {
      throw new QmsError(ERROR_CODES.LOCK_LOST, 'Project lock is no longer held by this process.', {
        details: { projectId: this.projectId, file: this.file }
      });
    }
  }

  async heartbeat({ force = false } = {}) {
    if (this.released) {
      throw new QmsError(ERROR_CODES.LOCK_LOST, 'Project lock has been released.');
    }
    const nowMs = this.clock.nowMs();
    if (!force && nowMs - this.lastHeartbeatMs < this.heartbeatIntervalMs) {
      return false;
    }
    await this.assertHeld();
    const info = await this.readInfo();
    await atomicWriteJson(this.file, {
      ...info,
      heartbeatAt: this.clock.nowIso(),
      pid: this.pid,
      hostname: this.hostname
    });
    this.lastHeartbeatMs = nowMs;
    return true;
  }

  async release() {
    if (this.released) {
      return { released: false, alreadyReleased: true };
    }
    const info = await readLockFile(this.file);
    if (!info || info.corrupt || info.token !== this.token) {
      throw new QmsError(
        ERROR_CODES.LOCK_RELEASE_DENIED,
        'Refusing to release a project lock owned by another process.',
        { details: { projectId: this.projectId, file: this.file } }
      );
    }
    await unlink(this.file);
    await fsyncDirectory(path.dirname(this.file));
    this.released = true;
    return { released: true };
  }
}

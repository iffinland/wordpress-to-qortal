import { statfs } from 'node:fs/promises';
import { QmsError, ERROR_CODES } from './errors.js';

/**
 * Disk-space probe and preflight model.
 *
 * The measurement is taken on the filesystem that actually contains the
 * migration workspace, not on an arbitrary path. Tests inject a deterministic
 * probe; production uses fs.statfs.
 */
export const DISK_REPORT_SCHEMA = 'qms-disk-report@1';

function toNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

export function createStatfsProbe({ statfsImpl = statfs } = {}) {
  return {
    async freeBytes(target) {
      const stats = await statfsImpl(target);
      const blockSize = toNumber(stats.bsize ?? stats.blocksize ?? 0);
      const availableBlocks = toNumber(stats.bavail ?? stats.bfree ?? 0);
      return blockSize * availableBlocks;
    },
    async inspect(target) {
      const stats = await statfsImpl(target);
      return {
        blockSize: toNumber(stats.bsize ?? stats.blocksize ?? 0),
        blocks: toNumber(stats.blocks ?? 0),
        availableBlocks: toNumber(stats.bavail ?? 0),
        freeBlocks: toNumber(stats.bfree ?? 0)
      };
    }
  };
}

export const defaultDiskProbe = createStatfsProbe();

export function fixedDiskProbe(freeBytes) {
  let current = Number(freeBytes);
  return {
    async freeBytes() {
      return current;
    },
    setFreeBytes(value) {
      current = Number(value);
    },
    consume(bytes) {
      current -= Number(bytes);
      return current;
    }
  };
}

export function sequenceDiskProbe(values) {
  const queue = [...values].map(Number);
  let last = queue.length > 0 ? queue[queue.length - 1] : 0;
  return {
    async freeBytes() {
      if (queue.length > 1) return queue.shift();
      if (queue.length === 1) last = queue[0];
      return last;
    }
  };
}

export async function measureFreeBytes(probe, target) {
  const effective = probe ?? defaultDiskProbe;
  try {
    const bytes = await effective.freeBytes(target);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new Error('invalid free space value');
    }
    return Math.floor(bytes);
  } catch (error) {
    throw new QmsError(ERROR_CODES.DISK_PROBE_FAILED, 'Could not measure free disk space for the migration workspace.', {
      cause: error,
      details: { target }
    });
  }
}

/**
 * Account for unknown content-length values. Unknown is never zero: the
 * selected policy either refuses the plan or reserves a bounded amount.
 */
export function accountUnknownBytes({ unknownCount = 0, limits }) {
  if (unknownCount <= 0) {
    return { unknownBytes: 0, blocked: false, code: null };
  }
  if (limits.unknownSizePolicy === 'reject') {
    return {
      unknownBytes: 0,
      blocked: true,
      code: ERROR_CODES.MEDIA_UNKNOWN_SIZE,
      message: 'Media content-length is unknown and the configured policy refuses unknown sizes.'
    };
  }
  if (limits.unknownSizePolicy === 'cap') {
    return { unknownBytes: unknownCount * limits.maxFileBytes, blocked: false, code: null };
  }
  if (limits.unknownSizePolicy === 'estimate') {
    return { unknownBytes: unknownCount * limits.unknownSizeBytes, blocked: false, code: null };
  }
  throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'Unknown disk size policy: ' + String(limits.unknownSizePolicy));
}

export async function diskPreflight({
  probe,
  workspacePath,
  limits,
  knownBytes = 0,
  unknownCount = 0,
  metadataBytes = 0
}) {
  const availableBytes = await measureFreeBytes(probe, workspacePath);
  const unknown = accountUnknownBytes({ unknownCount, limits });
  const unknownBytes = unknown.unknownBytes;
  const projectedMediaBytes = Math.ceil((knownBytes + unknownBytes) * limits.safetyFactor);
  const projectedBytes = projectedMediaBytes + Math.max(0, Math.floor(metadataBytes));
  const requiredBytes = projectedBytes + limits.reserveBytes;
  const fits = !unknown.blocked && availableBytes >= requiredBytes;
  return {
    schema: DISK_REPORT_SCHEMA,
    workspacePath,
    measuredAt: new Date().toISOString(),
    availableBytes,
    reserveBytes: limits.reserveBytes,
    knownBytes,
    unknownCount,
    unknownBytes,
    unknownSizePolicy: limits.unknownSizePolicy,
    metadataBytes,
    projectedMediaBytes,
    projectedBytes,
    requiredBytes,
    fits,
    insufficientBy: fits ? 0 : Math.max(0, requiredBytes - availableBytes),
    availableAfter: availableBytes - projectedBytes,
    reason: unknown.blocked
      ? unknown.code
      : fits
        ? null
        : ERROR_CODES.DISK_SPACE_INSUFFICIENT,
    message: unknown.blocked
      ? unknown.message
      : fits
        ? null
        : 'Projected download plus the configured reserve exceeds available disk space.'
  };
}

export function assertPreflightFits(report) {
  if (!report.fits) {
    throw new QmsError(
      report.reason ?? ERROR_CODES.DISK_SPACE_INSUFFICIENT,
      report.message ?? 'Disk preflight refused the run.',
      { details: report, retryable: true }
    );
  }
  return report;
}

/**
 * Runtime guard used before each bounded chunk write. A write that would
 * breach the reserve pauses the run instead of filling the volume.
 */
export async function runtimeDiskCheck({
  probe,
  workspacePath,
  reserveBytes,
  pendingBytes = 0
}) {
  const availableBytes = await measureFreeBytes(probe, workspacePath);
  const required = reserveBytes + Math.max(0, pendingBytes);
  return {
    availableBytes,
    reserveBytes,
    pendingBytes,
    ok: availableBytes >= required,
    code: availableBytes >= required ? null : ERROR_CODES.DISK_RESERVE_BREACH
  };
}

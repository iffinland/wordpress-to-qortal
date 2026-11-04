import { access, constants, statfs } from 'node:fs/promises';
import { verifyCompatibility } from './compat/index.js';
import { QmsError, ERROR_CODES } from './errors.js';

const LOW_DISK_BYTES = 64 * 1024 * 1024;

async function checkWritable(label, target) {
  try {
    await access(target, constants.W_OK);
    return { name: label, ok: true };
  } catch (error) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, `Required project path is missing: ${label}`, {
      cause: error,
      details: { label, path: target }
    });
  }
}

/**
 * Local-only project validation. No network access, no WordPress calls and no
 * QDN publishing: Phase 1 acceptance requires that no real import occurs.
 */
export async function runProjectValidation(handle, { signal = null } = {}) {
  const context = await handle.runs.start({ kind: 'project.validate' });
  const onAbort = () => context.controller.abort('cancelled');
  if (signal) {
    if (signal.aborted) {
      context.controller.abort('cancelled');
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const checks = [];
  const warnings = [];
  try {
    await context.phase('paths');
    context.throwIfCancelled();
    for (const [label, target] of [
      ['project_root', handle.paths.root],
      ['state_directory', handle.paths.stateDir],
      ['snapshot', handle.paths.snapshotFile],
      ['journal', handle.paths.journalFile],
      ['artifacts', handle.paths.artifactsDir]
    ]) {
      checks.push({ ...(await checkWritable(label, target)), phase: 'paths' });
    }
    await context.progress({
      completed: 1,
      total: 3,
      message: 'Project paths verified',
      code: 'VALIDATION_PATHS_OK',
      phase: 'paths'
    });

    await context.phase('compatibility');
    context.throwIfCancelled();
    const compatibility = verifyCompatibility(handle.project.compatibility, { repoRoot: handle.repoRoot });
    checks.push({ name: 'compatibility', ok: compatibility.ok, skipped: compatibility.skipped, phase: 'compatibility' });
    if (compatibility.skipped) {
      warnings.push('PROFILE_NOT_CONFIGURED');
      await context.warn('PROJECT_PROFILE_NOT_SET', 'Project has no compatibility profile configured.', {
        profileId: null
      });
    }
    for (const warning of compatibility.warnings ?? []) {
      warnings.push(warning);
      await context.warn('COMPATIBILITY_MISMATCH', `Compatibility profile mismatch: ${warning}`, {
        profileId: compatibility.profileId,
        warning
      });
    }
    await context.progress({
      completed: 2,
      total: 3,
      message: 'Compatibility settings verified',
      code: 'VALIDATION_COMPATIBILITY_OK',
      phase: 'compatibility'
    });

    await context.phase('storage');
    context.throwIfCancelled();
    let freeBytes = null;
    try {
      const stats = await statfs(handle.paths.root);
      freeBytes = Number(stats.bavail) * Number(stats.bsize);
    } catch {
      freeBytes = null;
      warnings.push('DISK_SPACE_UNKNOWN');
      await context.warn('DISK_SPACE_UNKNOWN', 'Could not determine free disk space.', {});
    }
    if (freeBytes !== null && freeBytes < LOW_DISK_BYTES) {
      warnings.push('LOW_DISK_SPACE');
      await context.warn('LOW_DISK_SPACE', 'Free disk space is below the 64 MiB advisory threshold.', {
        freeBytes
      });
    }
    checks.push({ name: 'storage', ok: true, freeBytes, phase: 'storage' });
    await context.progress({
      completed: 3,
      total: 3,
      message: 'Storage verified',
      code: 'VALIDATION_STORAGE_OK',
      phase: 'storage'
    });

    const completion = await context.complete({ checks, warnings });
    return {
      runId: completion.runId,
      status: 'completed',
      checks,
      warnings,
      events: completion.events
    };
  } catch (error) {
    if (error instanceof QmsError && error.code === ERROR_CODES.OPERATION_CANCELLED) {
      const cancellation = await context.cancel();
      return { runId: context.runId, status: 'cancelled', checks, warnings, events: cancellation?.events ?? [] };
    }
    const failure = await context.fail(error);
    return {
      runId: context.runId,
      status: 'failed',
      checks,
      warnings,
      error: error instanceof QmsError ? error.toJSON() : { code: 'UNEXPECTED', message: String(error) },
      events: failure?.events ?? []
    };
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

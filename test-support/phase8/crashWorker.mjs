import { readFile } from 'node:fs/promises';
import { createEngine } from '../../lib/engine/index.js';

/**
 * Phase 8 crash worker.
 *
 * Performs one real engine operation in a separate process and SIGKILLs itself
 * at the configured durable checkpoint. This simulates a power loss / OOM kill
 * without giving the engine a chance to run cleanup or failure handlers.
 *
 * argv: dataRoot projectId mode optionsJson
 * env:  QMS_CRASH_KIND, QMS_CRASH_STEP, QMS_CRASH_STAGE, QMS_CRASH_AFTER
 */
const [dataRoot, projectId, mode, optionsJson] = process.argv.slice(2);
const options = JSON.parse(optionsJson ?? '{}');
const crashKind = process.env.QMS_CRASH_KIND ?? null;
const crashStep = process.env.QMS_CRASH_STEP ?? null;
const crashStage = process.env.QMS_CRASH_STAGE ?? null;
const crashAfter = process.env.QMS_CRASH_AFTER ? Number(process.env.QMS_CRASH_AFTER) : null;
let kicked = false;

function die() {
  if (kicked) return;
  kicked = true;
  process.kill(process.pid, 'SIGKILL');
}

function match(payload) {
  if (kicked) return;
  if (crashKind && payload.kind !== crashKind) return;
  if (crashStep) {
    const step = payload.step ?? payload.phase ?? null;
    if (step !== crashStep) return;
  }
  if (crashStage && !String(payload.stageId ?? '').startsWith(crashStage)) return;
  die();
}

const engine = createEngine({
  dataRoot,
  onCheckpoint: (payload) => match(payload),
  onCleanupProgress: (payload) => {
    if (mode === 'cleanup' && crashAfter !== null && payload.movedCount >= crashAfter) die();
  }
});

const handle = await engine.projects.open(projectId, { recoverStaleLock: true, recoverOnOpen: false });

switch (mode) {
  case 'discover':
    await handle.source.discover({ mode: 'full', ...options });
    break;
  case 'plan':
    await handle.planning.create(options);
    break;
  case 'download':
    await handle.media.download(options);
    break;
  case 'prepare':
    await handle.publication.prepare(options);
    break;
  case 'receipt': {
    const receipt = JSON.parse(await readFile(options.receiptPath, 'utf8'));
    await handle.publication.importReceipt({ handoffId: options.handoffId, receipt });
    break;
  }
  case 'verify':
    await handle.publication.verify(options);
    break;
  case 'cleanup':
    await handle.cleanup.start(options);
    break;
  default:
    throw new Error('Unknown crash worker mode: ' + mode);
}

await handle.close();


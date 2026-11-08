/**
 * Single-flight planning request.
 *
 * Entering Plan Review can be signalled by more than one UI event in the same
 * tick (the step effect and the Continue handler). The engine refuses an
 * overlapping plan.create with OPERATION_ALREADY_RUNNING, so the renderer must
 * coalesce concurrent callers into one request. The epoch makes a late result
 * from an older request unable to overwrite or resurrect a newer one.
 */
export interface PlanPreviewRun<T> {
  task: () => Promise<T | null>;
  onStart?: () => void;
  onSuccess?: (result: T) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

export interface PlanPreviewFlight<T> {
  readonly running: boolean;
  readonly epoch: number;
  load(run: PlanPreviewRun<T>): Promise<void>;
  reset(): void;
}

export function createPlanPreviewFlight<T>(): PlanPreviewFlight<T> {
  let inFlight: Promise<void> | null = null;
  let epoch = 0;

  function load(run: PlanPreviewRun<T>): Promise<void> {
    if (inFlight) return inFlight;
    const requestId = ++epoch;
    const isCurrent = () => requestId === epoch;
    run.onStart?.();
    const promise = (async () => {
      try {
        const result = await run.task();
        if (!isCurrent() || result === null) return;
        run.onSuccess?.(result);
      } catch (error) {
        if (!isCurrent()) return;
        run.onError?.(error);
      } finally {
        if (isCurrent()) {
          inFlight = null;
          run.onSettled?.();
        }
      }
    })();
    inFlight = promise;
    return promise;
  }

  function reset(): void {
    epoch += 1;
    inFlight = null;
  }

  return {
    get running() { return inFlight !== null; },
    get epoch() { return epoch; },
    load,
    reset
  };
}

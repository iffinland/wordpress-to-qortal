import { describe, expect, it, vi } from 'vitest';
import { createPlanPreviewFlight } from '../../src/renderer/lib/plan-preview.js';

describe('plan preview single flight', () => {
  it('coalesces two concurrent loadPreview calls into one engine request', async () => {
    const flight = createPlanPreviewFlight<{ planId: string }>();
    let resolveTask!: (value: { planId: string }) => void;
    const task = vi.fn(() => new Promise<{ planId: string }>((resolve) => { resolveTask = resolve; }));
    const onStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const handlers = { task, onStart, onSuccess, onError, onSettled };

    const first = flight.load(handlers);
    const second = flight.load(handlers);
    expect(first).toBe(second);
    expect(flight.running).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);

    resolveTask({ planId: 'plan_one' });
    await Promise.all([first, second]);

    expect(task).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ planId: 'plan_one' });
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(flight.running).toBe(false);
  });

  it('allows a new request after the previous one settled', async () => {
    const flight = createPlanPreviewFlight<number>();
    const task = vi.fn(async () => 1);
    const onSuccess = vi.fn();
    await flight.load({ task, onSuccess });
    await flight.load({ task, onSuccess });
    expect(task).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it('never lets a stale result or error overwrite a newer request', async () => {
    const flight = createPlanPreviewFlight<string>();
    const resolvers: Array<(value: string) => void> = [];
    const rejecters: Array<(error: Error) => void> = [];
    const task = () => new Promise<string>((resolve, reject) => {
      resolvers.push(resolve);
      rejecters.push(reject);
    });

    const staleSuccess = vi.fn();
    const staleError = vi.fn();
    const freshSuccess = vi.fn();
    const freshError = vi.fn();

    void flight.load({ task, onSuccess: staleSuccess, onError: staleError });
    // Leaving Plan Review invalidates the request that is still in flight.
    flight.reset();
    void flight.load({ task, onSuccess: freshSuccess, onError: freshError });

    // The older request finishes late: its result and its error are discarded.
    resolvers[0]('stale');
    rejecters[0](new Error('Another plan.create operation is starting in this engine.'));
    await Promise.resolve();
    await Promise.resolve();
    expect(staleSuccess).not.toHaveBeenCalled();
    expect(staleError).not.toHaveBeenCalled();
    expect(freshSuccess).not.toHaveBeenCalled();

    resolvers[1]('fresh');
    await Promise.resolve();
    await Promise.resolve();
    expect(freshSuccess).toHaveBeenCalledWith('fresh');
    expect(freshError).not.toHaveBeenCalled();
    expect(flight.running).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/renderer/api.js';
import { mockApi } from './fixtures.js';

describe('typed failures across the isolated desktop bridge', () => {
  it('reconstructs a renderer Error with its recovery code and details', async () => {
    const bridge = mockApi();
    bridge.projects.open = vi.fn().mockRejectedValue({ code: 'PROJECT_LOCK_STALE', message: 'Recover this project.', details: { projectId: 'prj_abcdefgh' } });
    Object.freeze(bridge.projects);
    Object.freeze(bridge);
    window.qms = bridge;
    await expect(api().projects.open('prj_abcdefgh')).rejects.toMatchObject({ name: 'Error', code: 'PROJECT_LOCK_STALE', message: 'Recover this project.', details: { projectId: 'prj_abcdefgh' } });
  });
  it('keeps event subscriptions synchronous and returns the original disposer', () => {
    const bridge = mockApi();
    const dispose = vi.fn();
    bridge.events.on = vi.fn(() => dispose);
    window.qms = bridge;
    expect(api().events.on(vi.fn())).toBe(dispose);
  });
});

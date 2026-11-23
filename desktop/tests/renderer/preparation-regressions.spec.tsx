import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Progress } from '../../src/renderer/components/Progress.js';
import { Wizard } from '../../src/renderer/components/Wizard.js';
import { mockApi, plan, project, adapter, settings } from './fixtures.js';

describe('preparation controls and reviewed plans', () => {
  it('keeps pause/cancel available during media work and uses the planned concurrency', async () => {
    const api = mockApi(); window.qms = api;
    let emit: (event: unknown) => void = () => {};
    api.events.on = vi.fn((listener) => { emit = listener as typeof emit; return () => {}; });
    api.plans.get = vi.fn(async () => ({ plan: { ...plan(), config: { media: { concurrency: 1 } } }, record: { planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch_test', selectedCount: 1, conflictCount: 0, createdAt: '' }, planFile: '' }));
    api.media.download = vi.fn(() => new Promise<Awaited<ReturnType<typeof api.media.download>>>(() => {}));
    render(<Progress projectId="prj_abcdefgh" planId="plan_abcdefgh" onBack={vi.fn()} onHistory={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start media preparation' }));
    act(() => emit({ id: 'evt_1', project_id: 'prj_abcdefgh', run_id: 'run_active', type: 'operation_started', details: { kind: 'media.download' } }));
    expect(api.media.download).toHaveBeenCalledWith('prj_abcdefgh', 'plan_abcdefgh', { concurrency: 1 });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.runs.pause).toHaveBeenCalledWith('prj_abcdefgh', 'run_active'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
  it('refreshes the review after changing batch size', async () => {
    const api = mockApi(); window.qms = api;
    render(<Wizard project={project()} adapters={[adapter()]} settings={settings()} onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByTestId('plan-review');
    expect(api.plans.create).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    const batch = screen.getByDisplayValue('15'); await userEvent.clear(batch); await userEvent.type(batch, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('plan-review');
    expect(api.plans.create).toHaveBeenCalledTimes(2);
    expect(api.plans.create).toHaveBeenLastCalledWith('prj_abcdefgh', expect.objectContaining({ batchSize: 1, persist: false }));
  });
  it('persists the approved response plan ID when it differs from the preview', async () => {
    const api = mockApi(); window.qms = api;
    api.plans.create = vi.fn(async (_id, options) => ({ status: 'completed', planId: options.persist ? 'plan_persisted' : 'plan_preview', plan: { ...plan(), planId: options.persist ? 'plan_persisted' : 'plan_preview' }, runId: 'run_test' }));
    const done = vi.fn(async () => {});
    render(<Wizard project={project()} adapters={[adapter()]} settings={settings()} onClose={vi.fn()} onComplete={done} />);
    await screen.findByTestId('plan-review'); await userEvent.click(screen.getByRole('button', { name: 'Approve local preparation' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith('prj_abcdefgh', 'plan_persisted'));
    expect(api.projects.saveWizard).toHaveBeenLastCalledWith('prj_abcdefgh', expect.objectContaining({ planId: 'plan_persisted' }));
  });
});

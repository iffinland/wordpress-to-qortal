// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Recovery } from '../../src/renderer/components/Recovery.js';
import { mockApi } from './fixtures.js';

describe('recovery, cleanup and durable history', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('shows interrupted operations, resumes from a checkpoint and previews two-phase cleanup', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    window.qms = api;
    render(<Recovery projectId="prj_demo" onBack={vi.fn(async () => {})} />);

    expect(await screen.findByText('media.download')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Interrupted operations' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(api.recovery.resume).toHaveBeenCalledWith('prj_demo', { runId: 'run_abcdefgh12345678' });
    expect(await screen.findByText(/Recovery resumed from download_record/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview cleanup' }));
    expect(api.cleanup.preview).toHaveBeenCalledWith('prj_demo', { retentionDays: 14 });
    expect(await screen.findByText('Cleanup is eligible')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quarantine eligible files' }));
    expect(api.cleanup.start).toHaveBeenCalledWith('prj_demo', { retentionDays: 14 });
    expect(await screen.findByText(/Quarantined 1 file/)).toBeInTheDocument();
  });

  it('shows publication evidence in durable history and exports a support bundle', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    window.qms = api;
    render(<Recovery projectId="prj_demo" onBack={vi.fn(async () => {})} />);

    expect((await screen.findAllByText('publication_verified')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('remote_verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sig_abcdefghijklmnop/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Export history snapshot' }));
    expect(api.history.export).toHaveBeenCalledWith('prj_demo', 'manual-export');

    await user.click(screen.getByRole('button', { name: 'Export support bundle' }));
    expect(api.diagnostics.export).toHaveBeenCalledWith('prj_demo');
    expect(await screen.findByText(/Support bundle exported/)).toBeInTheDocument();
  });

  it('requires a node URL and reconciles ambiguous publications without resubmitting', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    const status = await api.recovery.status('prj_demo');
    api.recovery.status = vi.fn(async () => ({
      ...status,
      recovery: { ...status.recovery, ambiguousResources: 1 },
      ambiguousResources: [{
        handoffId: 'hof_abcdefgh12345678',
        resourceId: 'res_abcdefgh',
        service: 'DOCUMENT',
        name: 'DemoQortalName',
        identifier: 'qms-one',
        sha256: 'sha256:abcdef',
        bytes: 1024,
        reason: 'INTERRUPTED_BEFORE_RECEIPT',
        txSignature: null,
        requiresReconciliation: true
      }]
    }));
    window.qms = api;
    render(<Recovery projectId="prj_demo" onBack={vi.fn(async () => {})} />);

    expect(await screen.findByText('Ambiguous publications')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Reconcile read-back' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Qortal node URL for read-back'), 'http://127.0.0.1:12391');
    await user.click(button);
    expect(api.recovery.reconcile).toHaveBeenCalledWith('prj_demo', { handoffId: 'hof_abcdefgh12345678', nodeUrl: 'http://127.0.0.1:12391' });
    expect(await screen.findByText(/Resubmitted: no/)).toBeInTheDocument();
  });
});


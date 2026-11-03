// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Progress } from '../../src/renderer/components/Progress.js';
import { mockApi, plan } from './fixtures.js';

describe('preparation progress', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('distinguishes reserved work from publication and never advertises pause', async () => {
    const api = mockApi();
    api.plans.list = vi.fn(async () => [{ planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch_test', selectedCount: 1, pendingPublicationCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' }]);
    api.plans.get = vi.fn(async () => ({ plan: { ...plan(), download: { status: 'partial', downloadedBytes: 1024, files: 1, reused: 0 } }, record: { planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch_test', selectedCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' }, planFile: '/tmp/plan.json' }));
    window.qms = api;
    render(<Progress projectId="prj_abcdefgh" planId="plan_abcdefgh" onBack={vi.fn(async () => {})} onHistory={vi.fn(async () => {})} />);

    expect(await screen.findByText(/Reserved is not published/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing in this screen proves QDN publication/)).toBeInTheDocument();
    expect(screen.getByText(/Checkpoint\/resume only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Resume \/ repair media/ })).toBeInTheDocument();
    expect(screen.getAllByText(/partial/).length).toBeGreaterThan(0);
  });
});


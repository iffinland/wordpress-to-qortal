// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Publishing } from '../../src/renderer/components/Publishing.js';
import { mockApi, plan, project } from './fixtures.js';

const handoffSummary = {
  handoffId: 'hof_abcdefgh12345678',
  publicationBatchId: 'pub_abcdefgh12345678',
  planId: 'plan_abcdefgh',
  status: 'handoff_ready',
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
  target: { qdnName: 'DemoQortalName', resourcePrefix: 'qms' },
  estimate: { resourceCount: 1, feePerResource: 0.01, estimatedFee: 0.01, currency: 'QORT', label: 'Estimate only', batches: 1 },
  counts: { content: 1 },
  resourceCount: 1,
  handoffPath: 'publication/handoffs/hof_abcdefgh12345678'
};

const resource = {
  id: 'res_abcdefgh12345678',
  kind: 'content' as const,
  service: 'DOCUMENT',
  name: 'DemoQortalName',
  identifier: 'qms-ns-conabcdef',
  relativePath: 'payload/content/a.json',
  contentType: 'application/json; charset=utf-8',
  bytes: 100,
  sha256: 'sha256:' + 'a'.repeat(64),
  order: 0,
  dependsOn: [],
  status: 'handoff_ready',
  sourceKey: 'post:1'
};

describe('desktop publishing handoff flow', () => {
  beforeEach(() => {
    const api = mockApi();
    api.plans.list = vi.fn(async () => [{ planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch', selectedCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' }]);
    api.plans.get = vi.fn(async () => ({
      plan: plan(),
      record: { planId: 'plan_abcdefgh', status: 'ready', batchId: 'batch', selectedCount: 1, conflictCount: 0, createdAt: '2026-11-03T10:00:00.000Z' },
      planFile: '/tmp/plan.json'
    }));
    api.publication.list = vi.fn(async () => [handoffSummary]);
    api.publication.get = vi.fn(async () => ({
      handoff: { ...handoffSummary, projectId: project().id, siteId: project().siteId!, resources: [resource] },
      resources: [resource],
      absolutePath: '/data/projects/prj_demo/publication/handoffs/hof_abcdefgh12345678',
      packageValid: true,
      validation: { filesVerified: 1, summary: {} }
    }));
    api.publication.prepare = vi.fn(async () => ({
      handoffId: handoffSummary.handoffId,
      publicationBatchId: handoffSummary.publicationBatchId,
      planId: handoffSummary.planId,
      status: 'handoff_ready',
      handoffPath: handoffSummary.handoffPath,
      absolutePath: '/data/projects/prj_demo/publication/handoffs/hof_abcdefgh12345678',
      resources: [resource],
      counts: { content: 1 },
      estimate: handoffSummary.estimate,
      packageValidated: true,
      message: 'Handoff package created.'
    }));
    api.publication.verify = vi.fn(async () => ({
      handoffId: handoffSummary.handoffId,
      status: 'remote_verified',
      counts: { remote_verified: 1 },
      results: [{ resourceId: resource.id, state: 'remote_verified', code: 'EXACT_READBACK_VERIFIED', transport: 'qdn-http-base64' }],
      resources: [resource],
      evidencePath: 'publication/receipts/verification.json',
      pendingOrUnverified: 0
    }));
    window.qms = api;
  });

  it('prepares an explicit handoff, imports a receipt and requests independent verification', async () => {
    const user = userEvent.setup();
    render(<Publishing projectId="prj_abcdefgh" onBack={vi.fn()} />);

    expect(await screen.findByText('1 of 1 resources selected')).toBeInTheDocument();
    expect(await screen.findByText(/estimate only/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate handoff package' }));
    expect(await screen.findByText('Handoff package created.')).toBeInTheDocument();
    expect(window.qms.publication.prepare).toHaveBeenCalledWith('prj_abcdefgh', 'plan_abcdefgh', ['post:1'], expect.any(Object));

    await user.click(screen.getByRole('button', { name: 'Export Publisher package (.zip)' }));
    expect(window.qms.publication.exportBundle).toHaveBeenCalledWith('prj_abcdefgh', handoffSummary.handoffId);
    expect(await screen.findByText(/Publisher package exported/)).toBeInTheDocument();

    expect(await screen.findByText(/Package validated/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Receipt JSON'), { target: { value: JSON.stringify({ schema: 'qms-publication-receipt@1' }) } });
    await user.click(screen.getByRole('button', { name: 'Import receipt' }));
    await waitFor(() => expect(window.qms.publication.importReceipt).toHaveBeenCalledWith('prj_abcdefgh', handoffSummary.handoffId, expect.any(Object)));

    const nodeInput = screen.getByLabelText(/Qortal node URL/);
    await user.clear(nodeInput);
    await user.type(nodeInput, 'http://127.0.0.1:12391');
    await user.click(screen.getByRole('button', { name: 'Run independent QDN verification' }));
    expect(await screen.findByText(/Exact read-back completed for every resource/)).toBeInTheDocument();
    expect(window.qms.publication.verify).toHaveBeenCalled();
  });

  it('never renders wallet-secret fields or claims handoff_ready is published', async () => {
    render(<Publishing projectId="prj_abcdefgh" onBack={vi.fn()} />);
    expect(await screen.findByText('handoff ready')).toBeInTheDocument();
    expect(screen.queryByLabelText(/seed/i)).toBeNull();
    expect(screen.queryByLabelText(/private key/i)).toBeNull();
    expect(screen.queryByLabelText(/wallet password/i)).toBeNull();
    expect(screen.queryByText('Published (verified)')).toBeNull();
  });
});

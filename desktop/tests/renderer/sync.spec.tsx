// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncView } from '../../src/renderer/components/Sync.js';
import { mockApi, plan, syncScan, syncStatusFixture } from './fixtures.js';
import type { SyncConflict, SyncScanSummary, SyncStatus } from '../../src/shared/types.js';

const projectId = 'prj_abcdefgh';

function statusWith(scan: SyncScanSummary, overrides: Record<string, unknown> = {}): SyncStatus {
  return syncStatusFixture({ latestScan: scan, scans: [scan], ...overrides }) as SyncStatus;
}

const deltaEntry = (sourceKey: string, title: string) => ({
  sourceKey,
  contentType: 'post',
  title,
  slug: title.toLowerCase(),
  contentHash: 'sha256:' + sourceKey,
  classification: 'new'
});

const conflict: SyncConflict = {
  id: 'scf_external',
  kind: 'QDN_EXTERNAL_CHANGE',
  sourceKey: 'post:1',
  scanId: 'scn_test',
  status: 'open',
  severity: 'blocking',
  createdAt: '2026-11-03T10:00:00.000Z',
  resolvedAt: null,
  resolution: null,
  resolutionNote: null,
  automatic: false,
  evidence: {
    source: { sourceKey: 'post:1' },
    local: { mapping: { contentHash: 'sha256:local' } },
    qdn: { sha256: 'sha256:external' }
  },
  history: []
};

describe('synchronization desktop flow', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('runs a manual scan, shows explicit delta counts and prepares a delta publication plan', async () => {
    const user = userEvent.setup();
    const scan = syncScan({
      counts: { scanned: 7, new: 2, modified: 1, unchanged: 4 },
      delta: {
        new: [deltaEntry('post:1', 'First'), deltaEntry('post:2', 'Second')],
        modified: [deltaEntry('post:3', 'Third')],
        withdrawn: [],
        conflicts: [],
        unpublished: []
      }
    });
    const api = mockApi();
    api.sync.status = vi.fn(async () => statusWith(scan));
    api.sync.conflicts = vi.fn(async () => []);
    api.sync.check = vi.fn(async () => ({
      runId: 'run_sync',
      scanId: 'scn_test',
      status: 'completed',
      complete: true,
      planningAllowed: true,
      noChanges: false,
      counts: scan.counts,
      delta: scan.delta,
      warnings: [],
      query: {}
    }));
    api.sync.plan = vi.fn(async () => ({
      scanId: 'scn_test',
      status: 'completed',
      planId: 'plan_abcdefgh',
      plan: plan(),
      stats: plan().stats,
      media: plan().mediaSummary,
      disk: plan().disk
    }));
    window.qms = api;
    const onPublishing = vi.fn();
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={onPublishing} />);

    expect(await screen.findByTestId('sync-result')).toBeInTheDocument();
    expect(screen.getByTestId('count-new')).toHaveTextContent('2');
    expect(screen.getByTestId('count-modified')).toHaveTextContent('1');
    expect(screen.getByTestId('count-unchanged')).toHaveTextContent('4');

    await user.click(screen.getByRole('button', { name: /check for updates/i }));
    await waitFor(() => expect(api.sync.check).toHaveBeenCalledTimes(1));
    expect(api.sync.check).toHaveBeenCalledWith(projectId, expect.objectContaining({ mode: 'auto', perPage: 100 }));
    expect(await screen.findByTestId('sync-notice')).toHaveTextContent(/Scan completed/);

    await user.click(screen.getByRole('button', { name: /Prepare delta publication plan/i }));
    expect(await screen.findByTestId('sync-plan')).toBeInTheDocument();
    expect(screen.getByText(/Estimated fee 0.01 QORT/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue to Hub publication/i }));
    expect(onPublishing).toHaveBeenCalledWith('plan_abcdefgh');
  });

  it('never presents a failed scan as a successful no-change sync', async () => {
    const failed = syncScan({
      status: 'failed',
      complete: false,
      planningAllowed: false,
      counts: { scanned: 0, new: 0, modified: 0, unchanged: 0, withdrawn: 0, failed: 1 },
      failure: { code: 'SYNC_SCAN_FAILED', message: 'Source unavailable' },
      completedAt: '2026-11-03T10:01:00.000Z'
    });
    const api = mockApi();
    api.sync.status = vi.fn(async () => statusWith(failed, { counts: { mappings: 0, active: 0, withdrawn: 0, conflicts: 0, identityConflicts: 0, withdrawals: 0 } }));
    api.sync.conflicts = vi.fn(async () => []);
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    expect(await screen.findByText(/The scan failed or was cancelled/i)).toBeInTheDocument();
    expect(screen.queryByText(/No new or modified content was found/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Prepare delta publication plan/i })).toBeNull();
  });

  it('shows a partial scan honestly and offers no delta plan', async () => {
    const partial = syncScan({
      status: 'incomplete',
      complete: false,
      planningAllowed: false,
      truncated: true,
      counts: { scanned: 2, new: 2, withdrawn: 0 },
      warnings: [{ code: 'SYNC_SCAN_INCOMPLETE', message: 'The source scan was truncated or partial; deletions and watermarks were not inferred.' }]
    });
    const api = mockApi();
    api.sync.status = vi.fn(async () => statusWith(partial));
    api.sync.conflicts = vi.fn(async () => []);
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    expect(await screen.findByText(/This scan is incomplete or truncated/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare delta publication plan/i })).toBeNull();
  });

  it('resumes an interrupted scan from its checkpoint', async () => {
    const user = userEvent.setup();
    const interrupted = syncScan({
      status: 'interrupted',
      complete: false,
      planningAllowed: false,
      recoverable: true,
      counts: { scanned: 2, new: 2 }
    });
    const completed = syncScan({ status: 'completed', counts: { scanned: 5, new: 5 } });
    const api = mockApi();
    api.sync.status = vi.fn()
      .mockResolvedValueOnce(statusWith(interrupted))
      .mockResolvedValue(statusWith(completed));
    api.sync.conflicts = vi.fn(async () => []);
    api.sync.resume = vi.fn(async () => ({
      runId: 'run_sync',
      scanId: 'scn_test',
      status: 'completed',
      complete: true,
      planningAllowed: true,
      noChanges: false,
      counts: completed.counts
    }));
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Resume scan/i }));
    await waitFor(() => expect(api.sync.resume).toHaveBeenCalledWith(projectId, 'scn_test'));
    expect(await screen.findByTestId('sync-notice')).toHaveTextContent(/Scan resumed and finished/);
  });

  it('adopts an existing migration without changing identities', async () => {
    const user = userEvent.setup();
    const scan = syncScan({ counts: { unchanged: 3 } });
    const api = mockApi();
    api.sync.status = vi.fn()
      .mockResolvedValueOnce(statusWith(scan, { adoptionRequired: true }))
      .mockResolvedValue(statusWith(scan, { adoptionRequired: false, adoptionCount: 1 }));
    api.sync.conflicts = vi.fn(async () => []);
    api.sync.adoptions = vi.fn(async () => []);
    api.sync.adopt = vi.fn(async () => ({
      schema: 'qms-sync-adoption-report@1',
      projectId,
      siteId: 'site_x',
      adoptedAt: '2026-11-03T10:00:00.000Z',
      note: null,
      mappingCount: 3,
      activeMappingCount: 3,
      withdrawnMappingCount: 0,
      verifiedResourceCount: 3,
      handoffCount: 1,
      issues: [],
      changedIdentities: false,
      message: 'Existing migration adopted without changing verified QDN identities.'
    }));
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    expect(await screen.findByText(/Existing migration adoption/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Adopt existing migration/i }));
    await waitFor(() => expect(api.sync.adopt).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('sync-notice')).toHaveTextContent(/without changing verified QDN identities/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Adopt existing migration/i })).toBeNull());
  });

  it('persists and resolves a QDN external-change conflict with an audited choice', async () => {
    const user = userEvent.setup();
    const scan = syncScan({ counts: { new: 1, conflicts: 1 } });
    const api = mockApi();
    api.sync.status = vi.fn(async () => statusWith(scan));
    api.sync.conflicts = vi.fn()
      .mockResolvedValueOnce([conflict])
      .mockResolvedValue([]);
    api.sync.resolveConflict = vi.fn(async (): Promise<SyncConflict> => ({ ...conflict, status: 'resolved', resolution: 'take_source' }));
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    expect(await screen.findByText(/QDN EXTERNAL CHANGE/i)).toBeInTheDocument();
    expect(screen.getByTestId('count-conflicts')).toHaveTextContent('1');
    expect(screen.getByText(/will never be overwritten until/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Authorize source overwrite/i }));
    await waitFor(() => expect(api.sync.resolveConflict).toHaveBeenCalledWith(
      projectId,
      'scf_external',
      'take_source',
      expect.any(String)
    ));
    expect(await screen.findByTestId('sync-notice')).toHaveTextContent(/resolved as take source/);
    await waitFor(() => expect(screen.queryByText(/QDN EXTERNAL CHANGE/i)).toBeNull());
  });

  it('applies withdrawal locally and prepares tombstones without claiming a network delete', async () => {
    const user = userEvent.setup();
    const withdrawn = {
      sourceKey: 'post:9',
      contentType: 'post',
      title: 'Withdrawn post',
      contentHash: 'sha256:gone',
      classification: 'withdrawn',
      reason: 'MISSING_FROM_COMPLETE_SOURCE_SCAN'
    };
    const scan = syncScan({
      counts: { scanned: 3, unchanged: 2, withdrawn: 1 },
      delta: { new: [], modified: [], withdrawn: [withdrawn], conflicts: [], unpublished: [] }
    });
    const api = mockApi();
    api.sync.status = vi.fn(async () => statusWith(scan, { counts: { mappings: 3, active: 2, withdrawn: 1, conflicts: 0, identityConflicts: 0, withdrawals: 1 } }));
    api.sync.conflicts = vi.fn(async () => []);
    api.sync.withdraw = vi.fn(async () => ({
      applied: [{ withdrawalId: 'wdr_1', sourceKey: 'post:9', policy: 'hide', networkDeleted: false, qdnDataPreserved: true }],
      appliedCount: 1,
      pending: 0,
      policy: 'hide',
      networkDeleted: false,
      qdnDataPreserved: true,
      message: 'Local withdrawal recorded. Previously published QDN resources were NOT deleted.'
    }));
    api.sync.prepareTombstones = vi.fn(async () => ({
      scanId: 'scn_test',
      prepared: [{ sourceKey: 'post:9', withdrawalId: 'wdr_1', relativePath: 'artifacts/sync/scn_test/tombstones/a.json', sha256: 'sha256:a', bytes: 10, published: false, networkDeleted: false }],
      preparedCount: 1,
      published: false,
      networkDeleted: false,
      message: 'Tombstones are prepared locally only.'
    }));
    window.qms = api;
    render(<SyncView projectId={projectId} onBack={vi.fn()} onPublishing={vi.fn()} />);

    expect(await screen.findByText(/never deletes published QDN data/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Apply withdrawal policy/i }));
    await waitFor(() => expect(api.sync.withdraw).toHaveBeenCalledWith(
      projectId,
      'scn_test',
      expect.objectContaining({ policy: 'hide', sourceKeys: ['post:9'] })
    ));
    expect(await screen.findByTestId('sync-notice')).toHaveTextContent(/NOT deleted/);

    await user.click(screen.getByRole('button', { name: /Prepare tombstones only/i }));
    expect(await screen.findByTestId('sync-tombstones')).toHaveTextContent(/prepared · not published/);
    expect(api.sync.prepareTombstones).toHaveBeenCalledTimes(1);
  });
});

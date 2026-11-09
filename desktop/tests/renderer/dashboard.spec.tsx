// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/renderer/components/Dashboard.js';
import { adapter, mockApi, project } from './fixtures.js';
import type { ProjectInspection } from '../../src/shared/types.js';

describe('project dashboard', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('shows reserved work separately from published work and never equates archived with published', async () => {
    const archived = project({ id: 'prj_hijklmno', name: 'Archived publication', archivedAt: '2026-11-02T10:00:00.000Z' });
    const api = mockApi();
    api.projects.list = vi.fn(async () => [project(), archived]);
    const inspection = (pending: number): ProjectInspection => ({
      project: project() as never,
      identity: { siteId: 'site_x', namespace: 'nsx', target: { qdnName: 'DemoQortalName' }, mappingCount: pending, pendingPublicationCount: pending, preparedCount: 0, publishedCount: 0, unresolvedConflicts: 0 },
      runs: [],
      plans: [],
      lastActivity: '2026-11-03T10:00:00.000Z',
      activeRuns: 0,
      interruptedRuns: 0
    });
    api.projects.inspect = vi.fn(async (projectId: string) => inspection(projectId === 'prj_abcdefgh' ? 2 : 0));
    window.qms = api;
    render(<Dashboard projects={[project(), archived]} adapters={[adapter()]} onRefresh={vi.fn(async () => {})} onOpen={vi.fn(async () => {})} onHistory={vi.fn(async () => {})} onSync={vi.fn(async () => {})} onRecovery={vi.fn(async () => {})} />);

    expect(await screen.findByText('2 reserved')).toBeInTheDocument();
    expect(screen.getByText('Reserved locally — not published. Continue preparation or publish in Phase 5.')).toBeInTheDocument();
    expect(screen.getByText('Archived projects are not assumed published.')).toBeInTheDocument();
    expect(screen.getAllByText('Demo publication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('https://example.org').length).toBeGreaterThan(0);
  });
  it('continues the exact existing site without creating or replacing its identity', async () => {
    const existing = project();
    const onOpen = vi.fn(async () => {});
    const client = mockApi();
    client.projects.create = vi.fn();
    window.qms = client;
    render(<Dashboard projects={[existing]} adapters={[adapter()]} onRefresh={vi.fn(async () => {})}
      onOpen={onOpen} onHistory={vi.fn(async () => {})} onSync={vi.fn(async () => {})} onRecovery={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByText('New site or continue existing site'));
    fireEvent.change(screen.getByLabelText('Site workflow'), { target: { value: 'continue' } });
    fireEvent.change(screen.getByLabelText('Existing QMS site'), { target: { value: existing.id } });
    fireEvent.click(screen.getByText('Continue selected site'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(existing.id));
    expect(client.projects.create).not.toHaveBeenCalled();
    expect(screen.getByText(/restore its original QMS workspace/)).toBeInTheDocument();
  });

  it('warns that reusing a Qortal name in a new project starts a separate catalog', async () => {
    const existing = project();
    render(<Dashboard projects={[existing]} adapters={[adapter()]} onRefresh={vi.fn(async () => {})}
      onOpen={vi.fn(async () => {})} onHistory={vi.fn(async () => {})} onSync={vi.fn(async () => {})} onRecovery={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByText('New site or continue existing site'));
    fireEvent.change(screen.getByLabelText(/Qortal name/), { target: { value: existing.targetQdnName } });
    expect(screen.getByRole('status')).toHaveTextContent('Creating here starts a separate site with a different namespace');
    expect(screen.getByText('Create new independent site')).toBeInTheDocument();
  });

});


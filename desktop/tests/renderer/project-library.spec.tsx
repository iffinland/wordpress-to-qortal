import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ProjectLibrary } from '../../src/renderer/components/ProjectLibrary.js';
import { ProjectSettings } from '../../src/renderer/components/ProjectSettings.js';
import { GuidedStudio } from '../../src/renderer/components/GuidedStudio.js';
import { mockApi, project } from './fixtures.js';
import { validateIpcPayload } from '../../src/shared/validation.js';
import { IPC } from '../../src/shared/channels.js';

describe('guided project management', () => {
  it('reactivates an archived project without creating another site', async () => {
    const client = mockApi(); window.qms = client; const refresh = vi.fn(async () => {});
    render(<ProjectLibrary projects={[project({ archivedAt: '2026-11-01' })]} busy={false} onOpen={vi.fn()} onNew={vi.fn()} onRefresh={refresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore to active projects' }));
    await waitFor(() => expect(client.projects.unarchive).toHaveBeenCalledWith('prj_abcdefgh'));
    expect(client.projects.create).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalled();
  });
  it('explains reversible removal before moving the local project to deleted projects', async () => {
    const client = mockApi(); window.qms = client;
    render(<ProjectLibrary projects={[project()]} busy={false} onOpen={vi.fn()} onNew={vi.fn()} onRefresh={vi.fn(async () => {})} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from this computer' }));
    expect(client.projects.archive).not.toHaveBeenCalled();
    expect(screen.getByText(/QDN content is preserved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move to Deleted projects' }));
    await waitFor(() => expect(client.projects.archive).toHaveBeenCalledWith('prj_abcdefgh', true));
  });
  it('allows the local project label to change without resetting a pending website', async () => {
    const client = mockApi(); window.qms = client;
    render(<ProjectSettings project={project()} nodeUrl="http://127.0.0.1:12391" onBack={vi.fn()} onSaved={vi.fn(async () => {})} />);
    const name = screen.getByLabelText(/Local project name/); await userEvent.clear(name); await userEvent.type(name, 'My second archive');
    await userEvent.click(screen.getByRole('button', { name: 'Save local name' }));
    await waitFor(() => expect(client.projects.update).toHaveBeenCalledWith('prj_abcdefgh', { name: 'My second archive' }));
    expect(client.workflow).not.toHaveBeenCalled();
  });
  it('keeps an existing source available as an independent project choice', async () => {
    const client = mockApi(); window.qms = client;
    render(<GuidedStudio onAdvanced={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a website' }));
    await userEvent.type(screen.getByLabelText('WordPress website address'), 'https://example.org');
    expect(screen.getByLabelText('Create an independent project with its own catalog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue Demo publication' })).toBeInTheDocument();
  });
  it('preserves website settings and guided preferences across the IPC boundary without accepting forged approvals', () => {
    const result = validateIpcPayload(IPC.projectUpdate, { projectId: 'prj_abcdefgh', patch: { settings: { website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'My archive' }, guidedDraft: { mode: 'range', after: '2024-01-01' }, destinationApproval: { signature: 'forged' } } } });
    expect(result.patch).toEqual({ settings: { website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'My archive' }, guidedDraft: { mode: 'range', after: '2024-01-01' } } });
    expect(() => validateIpcPayload(IPC.projectRestoreTrash, { trashId: '../projects' })).toThrow();
  });
});

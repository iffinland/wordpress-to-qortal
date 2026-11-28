import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { GuidedStudio } from '../../src/renderer/components/GuidedStudio.js';
import { ProjectSettings } from '../../src/renderer/components/ProjectSettings.js';
import { mockApi, project } from './fixtures.js';

describe('website login and persistent project navigation', () => {
  it('sends ordinary website credentials as session login, with application password kept separate', async () => {
    const client = mockApi(); window.qms = client;
    render(<GuidedStudio onAdvanced={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a website' }));
    await userEvent.type(screen.getByLabelText('WordPress website address'), 'https://another.example');
    expect(screen.getByRole('option', { name: /Public content/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /generated separately/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/WordPress access method/), 'session');
    expect(screen.getByText('Trouble signing in?').closest('details')).not.toHaveAttribute('open');
    await userEvent.type(screen.getByLabelText('WordPress username or email'), 'member@example.test');
    await userEvent.type(screen.getByLabelText(/Website login password/), 'normal-password');
    await userEvent.click(screen.getByRole('button', { name: 'Connect and continue' }));
    await waitFor(() => expect(client.sources.validate).toHaveBeenCalledWith('prj_abcdefgh', expect.objectContaining({ auth: { mode: 'session', username: 'member@example.test', password: 'normal-password' } })));
    expect(client.sources.openLogin).not.toHaveBeenCalled();
  });
  it('has a visible Home action from project settings and keeps the existing project', async () => {
    const client = mockApi(); window.qms = client;
    render(<GuidedStudio onAdvanced={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue this website' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
    await screen.findByLabelText(/Local project name/);
    await userEvent.click(screen.getByRole('button', { name: 'Projects / Home' }));
    expect(await screen.findByRole('heading', { name: 'Your projects' })).toBeInTheDocument();
    expect(client.projects.archive).not.toHaveBeenCalled();
  });
  it('keeps the active preparation running when returning to the project list', async () => {
    const client = mockApi(); window.qms = client;
    client.workflow = vi.fn(async () => ({ status: 'scanning', running: true, message: 'Reading saved project' }));
    render(<GuidedStudio onAdvanced={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue this website' }));
    await screen.findByRole('button', { name: 'Pause safely' });
    await userEvent.click(screen.getByRole('button', { name: 'Projects / Home' }));
    expect(await screen.findByRole('heading', { name: 'Your projects' })).toBeInTheDocument();
    expect(vi.mocked(client.workflow).mock.calls.every(([, action]) => action === 'status')).toBe(true);
  });
  it('offers the interactive login window from existing project connection settings', async () => {
    const client = mockApi(); window.qms = client;
    render(<ProjectSettings project={project({ source: { adapter: 'wordpress', baseUrl: 'https://example.org', authMode: 'session' } })} nodeUrl="http://127.0.0.1:12391" onBack={vi.fn()} onSaved={vi.fn(async () => {})} />);
    await userEvent.click(screen.getByText('Trouble signing in?'));
    await userEvent.click(screen.getByRole('button', { name: 'Open WordPress login window' }));
    await waitFor(() => expect(client.sources.openLogin).toHaveBeenCalledWith('prj_abcdefgh'));
    await userEvent.click(screen.getByRole('button', { name: 'Use signed-in session' }));
    await waitFor(() => expect(client.sources.completeLogin).toHaveBeenCalledWith('prj_abcdefgh'));
    expect(client.sources.validate).not.toHaveBeenCalled();
  });
});

it('returns through Home and resumes a saved content choice in the same project', async () => {
  const client = mockApi(); window.qms = client; let current = project();
  client.projects.open = vi.fn(async () => ({ project: current, snapshot: {} }));
  client.projects.update = vi.fn(async (_id, patch) => { current = { ...current, ...patch, settings: { ...current.settings, ...(patch.settings as object ?? {}) } }; return { project: current }; });
  render(<GuidedStudio onAdvanced={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Continue this website' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Connect and continue' }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Choose a date range' }));
  await userEvent.type(screen.getByLabelText('From date (UTC)'), '2024-02-01');
  await userEvent.click(screen.getByRole('button', { name: 'Projects / Home' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Continue this website' }));
  expect(await screen.findByLabelText('From date (UTC)')).toHaveValue('2024-02-01');
  expect(client.sources.validate).toHaveBeenCalledTimes(1);
});

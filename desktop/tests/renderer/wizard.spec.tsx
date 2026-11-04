// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Wizard } from '../../src/renderer/components/Wizard.js';
import { adapter, mockApi, plan, project, settings } from './fixtures.js';
import type { QmsApi } from '../../src/shared/types.js';

describe('setup wizard', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('reports adapter capabilities from data instead of hardcoding WordPress', () => {
    window.qms = mockApi();
    render(<Wizard project={project({ settings: { desktopWizard: { step: 1, completedSteps: [], adapterId: 'wordpress', sourceUrl: '', authMode: 'none', connection: null, targetQdnName: '', siteTitle: '', siteDescription: '', preferences: {}, planId: null, updatedAt: '2026-11-03T10:00:00.000Z' } } })} adapters={[adapter()]} settings={settings()} onClose={vi.fn(async () => {})} onComplete={vi.fn(async () => {})} />);
    expect(screen.getByText(/Content: post, page/)).toBeInTheDocument();
    expect(screen.getByText(/Auth: none, application_password/)).toBeInTheDocument();
    expect(screen.getByText(/Unsupported: comments/)).toBeInTheDocument();
  });

  it('blocks progress from the connection step until validation succeeds', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    window.qms = api;
    render(<Wizard
      project={project({ settings: { desktopWizard: { step: 2, completedSteps: [1], adapterId: 'wordpress', sourceUrl: 'https://example.org', authMode: 'none', connection: null, targetQdnName: 'DemoQortalName', siteTitle: 'Demo', siteDescription: '', preferences: {}, planId: null, updatedAt: '2026-11-03T10:00:00.000Z' } } })}
      adapters={[adapter()]}
      settings={settings()}
      onClose={vi.fn(async () => {})}
      onComplete={vi.fn(async () => {})}
    />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Test the connection before continuing.')).toBeInTheDocument();
    expect(api.projects.saveWizard).not.toHaveBeenCalled();
  });

  it('renders qms-plan@1 review data and approves local preparation only', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    window.qms = api;
    const onComplete = vi.fn(async () => {});
    render(<Wizard project={project()} adapters={[adapter()]} settings={settings()} onClose={vi.fn(async () => {})} onComplete={onComplete} />);

    expect(await screen.findByTestId('plan-review')).toBeInTheDocument();
    expect(screen.getByText(/Estimate only/)).toBeInTheDocument();
    expect(screen.getByText(/Reserved — not published/)).toBeInTheDocument();
    expect(screen.getByText(/Publication requires Phase 5 remote read-back/)).toBeInTheDocument();
    expect(screen.getByText(/First post/)).toBeInTheDocument();

    const previewCall = (api.plans.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((previewCall[1] as Record<string, unknown>).persist).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Approve local preparation' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('prj_abcdefgh', 'plan_abcdefgh'));
    const approveCall = (api.plans.create as ReturnType<typeof vi.fn>).mock.calls[1];
    expect((approveCall[1] as Record<string, unknown>).persist).toBe(true);
    expect(api.projects.saveWizard).toHaveBeenCalled();
  });

  it('does not repeat technical identifiers as editable fields', async () => {
    window.qms = mockApi();
    render(<Wizard project={project({ settings: { desktopWizard: { step: 3, completedSteps: [1, 2], adapterId: 'wordpress', sourceUrl: 'https://example.org', authMode: 'none', connection: { status: 'completed', report: { ok: true } }, targetQdnName: 'DemoQortalName', siteTitle: 'Demo publication', siteDescription: '', preferences: {}, planId: null, updatedAt: '2026-11-03T10:00:00.000Z' } } })} adapters={[adapter()]} settings={settings()} onClose={vi.fn(async () => {})} onComplete={vi.fn(async () => {})} />);
    expect(screen.queryByDisplayValue('site_0123456789abcdef0123456789abcdef')).toBeNull();
    expect(screen.getByText('site_0123456789abcdef0123456789abcdef')).toBeInTheDocument();
  });
});


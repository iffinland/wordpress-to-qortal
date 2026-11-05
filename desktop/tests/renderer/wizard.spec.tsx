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
    // Rendering a legacy numeric record migrates and persists it once; the
    // failed Continue action must not add another save.
    await waitFor(() => expect(api.projects.saveWizard).toHaveBeenCalledTimes(1));
    (api.projects.saveWizard as ReturnType<typeof vi.fn>).mockClear();
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

  it('renders unsupported capabilities as readable features and never stringifies objects', async () => {
    window.qms = mockApi();
    render(<Wizard
      project={project({ settings: { desktopWizard: {
        step: 2,
        completedSteps: [1],
        adapterId: 'wordpress',
        sourceUrl: 'https://example.org',
        authMode: 'none',
        connection: {
          status: 'completed',
          report: {
            ok: true,
            auth: { mode: 'none', authenticated: true },
            counts: { posts: 1145 },
            contentTypes: ['post', 'page'],
            unsupported: [
              { code: 'UNSUPPORTED_CONTENT_TYPE', type: 'event', name: 'Events', count: 3, supported: false },
              { code: 'UNSUPPORTED_SOURCE_FEATURE', feature: 'comments', message: 'Comments are not migrated.', supported: false }
            ],
            warnings: []
          }
        },
        targetQdnName: 'DemoQortalName',
        siteTitle: 'Demo',
        siteDescription: '',
        preferences: {},
        planId: null,
        updatedAt: '2026-11-03T10:00:00.000Z'
      } } })}
      adapters={[adapter()]}
      settings={settings()}
      onClose={vi.fn(async () => {})}
      onComplete={vi.fn(async () => {})}
    />);
    const block = await screen.findByTestId('unsupported-features');
    expect(block.textContent).toContain('Events');
    expect(block.textContent).toContain('Comments are not migrated.');
    expect(block.textContent).not.toContain('[object Object]');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('shows the underlying plan failure and disables approval', async () => {
    const api = mockApi();
    (api.plans.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: 'run_failed',
      status: 'failed',
      error: { code: 'SOURCE_DISCOVERY_REQUIRED', message: 'No completed source discovery batch exists for this project.', details: { adapter: 'wordpress' } }
    });
    window.qms = api;
    render(<Wizard project={project()} adapters={[adapter()]} settings={settings()} onClose={vi.fn(async () => {})} onComplete={vi.fn(async () => {})} />);
    expect(await screen.findByText(/Planning failed: SOURCE_DISCOVERY_REQUIRED/)).toBeInTheDocument();
    expect(screen.getAllByText(/No completed source discovery batch exists/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Approve local preparation' })).toBeDisabled();
  });

  it('explains an empty plan and blocks empty approval', async () => {
    const api = mockApi();
    (api.plans.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: 'run_empty',
      status: 'completed',
      planId: 'plan_empty0001',
      stats: { selected: 0, scanned: 0, new: 0, modified: 0, conflict: 0 },
      filterDiagnostics: {
        indexed: 1145, supported: 1174, unsupported: 0, contentTypeExcluded: 29,
        sourceKeyExcluded: 0, statusExcluded: 0, searchExcluded: 0, missingPublishedAt: 0,
        publishedBeforeAfter: 1145, publishedAfterBefore: 0, modifiedOutsideRange: 0,
        matched: 0, actionable: 0
      },
      plan: {
        ...plan(),
        planId: 'plan_empty0001',
        status: 'ready',
        stats: { selected: 0, scanned: 0, new: 0, modified: 0, conflict: 0, unsupported: 0 },
        filterDiagnostics: {
          indexed: 1145, supported: 1174, unsupported: 0, contentTypeExcluded: 29,
          sourceKeyExcluded: 0, statusExcluded: 0, searchExcluded: 0, missingPublishedAt: 0,
          publishedBeforeAfter: 1145, publishedAfterBefore: 0, modifiedOutsideRange: 0,
          matched: 0, actionable: 0
        },
        filters: { after: '2026-10-05T00:00:00.000Z', before: '2026-10-21T23:59:59.999Z' },
        selection: {
          empty: true,
          emptyReason: 'NO_ITEMS_MATCH_FILTERS',
          emptyExplanation: [
            'No indexed item matches the current filters.',
            '1145 item(s) were published before the lower bound.'
          ]
        },
        entries: []
      }
    });
    window.qms = api;
    render(<Wizard project={project()} adapters={[adapter()]} settings={settings()} onClose={vi.fn(async () => {})} onComplete={vi.fn(async () => {})} />);
    expect(await screen.findByText('No content matches the current filters')).toBeInTheDocument();
    expect(screen.getByText(/1145 item\(s\) were published before the lower bound/)).toBeInTheDocument();
    expect(screen.getByText(/Published from 2026-10-05 00:00 UTC through 2026-10-21 23:59 UTC/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve local preparation' })).toBeDisabled();
    expect(screen.getByText(/No content matches the current filters, so nothing can be approved/)).toBeInTheDocument();
  });

  it('shows the applied date range and migrates a legacy midnight end date', async () => {
    window.qms = mockApi();
    render(<Wizard
      project={project({ settings: { desktopWizard: {
        step: 4,
        completedSteps: [1, 2, 3],
        adapterId: 'wordpress',
        sourceUrl: 'https://example.org',
        authMode: 'none',
        connection: { status: 'completed', report: { ok: true } },
        targetQdnName: 'DemoQortalName',
        siteTitle: 'Demo',
        siteDescription: '',
        preferences: { after: '2026-10-05T00:00:00.000Z', before: '2026-10-21T00:00:00.000Z' },
        planId: null,
        updatedAt: '2026-11-03T10:00:00.000Z'
      } } })}
      adapters={[adapter()]}
      settings={settings()}
      onClose={vi.fn(async () => {})}
      onComplete={vi.fn(async () => {})}
    />);
    expect(screen.getByTestId('applied-date-filter').textContent).toContain('Published from 2026-10-05 00:00 UTC through 2026-10-21 23:59 UTC');
    expect(screen.getByDisplayValue('2026-10-21')).toBeInTheDocument();
  });

  it('warns when the hosting service changes and explains APP vs WEBSITE', async () => {
    const user = userEvent.setup();
    window.qms = mockApi();
    render(<Wizard
      project={project({ settings: {
        website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'Demo tagline', theme: { colors: { accent: '#4da3ff' } } },
        desktopWizard: {
          step: 3,
          completedSteps: [1, 2],
          adapterId: 'wordpress',
          sourceUrl: 'https://example.org',
          authMode: 'none',
          connection: { status: 'completed', report: { ok: true } },
          targetQdnName: 'developer iffi',
          siteTitle: 'Demo',
          siteDescription: '',
          website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'Demo tagline', accent: '#4da3ff' },
          preferences: {},
          planId: null,
          updatedAt: '2026-11-03T10:00:00.000Z'
        }
      } })}
      adapters={[adapter()]}
      settings={settings()}
      onClose={vi.fn(async () => {})}
      onComplete={vi.fn(async () => {})}
    />);
    const safety = screen.getByTestId('service-safety');
    expect(safety.textContent).toContain('APP and WEBSITE are separate deployments');
    await user.selectOptions(screen.getByLabelText(/Website hosting service/i), 'APP');
    expect(screen.getByTestId('service-safety').textContent).toContain('Hosting service changed');
    expect(screen.getByTestId('service-safety').textContent).toContain('You changed WEBSITE to APP');
  });
});


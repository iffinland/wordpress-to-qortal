// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { History } from '../../src/renderer/components/History.js';
import { mockApi, project } from './fixtures.js';

describe('history and diagnostics', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('separates reserved, prepared and published mappings and exports metadata diagnostics', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    api.projects.open = vi.fn(async () => ({ project: project(), snapshot: {} }));
    api.identity.get = vi.fn(async () => ({
      identity: { siteId: 'site_x', namespace: 'nsx' },
      mappings: [
        { sourceKey: 'post:1', contentType: 'post', service: 'DOCUMENT', name: 'DemoQortalName', identifier: 'qms-one', contentHash: 'a', routeHash: 'b', status: 'reserved', publicationStatus: 'reserved', localPreparation: 'reserved', planId: 'plan_abcdefgh' },
        { sourceKey: 'post:2', contentType: 'post', service: 'DOCUMENT', name: 'DemoQortalName', identifier: 'qms-two', contentHash: 'c', routeHash: 'd', status: 'reserved', publicationStatus: 'reserved', localPreparation: 'prepared', preparedAt: '2026-11-03T10:00:00.000Z', planId: 'plan_abcdefgh' },
        { sourceKey: 'post:3', contentType: 'post', service: 'DOCUMENT', name: 'DemoQortalName', identifier: 'qms-three', contentHash: 'e', routeHash: 'f', status: 'published', publicationStatus: 'published', localPreparation: 'prepared', planId: 'plan_old' }
      ],
      conflicts: []
    }));
    window.qms = api;
    render(<History projectId="prj_abcdefgh" onBack={vi.fn(async () => {})} onProgress={vi.fn(async () => {})} />);

    expect(await screen.findByText('Prepared locally — not published')).toBeInTheDocument();
    expect(screen.getByText('Reserved — not published')).toBeInTheDocument();
    expect(screen.getByText('Published (verified)')).toBeInTheDocument();
    expect(screen.getByText(/A reserved mapping means the identity was planned or prepared locally/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export diagnostics' }));
    expect(await screen.findByText(/Diagnostics exported. Secrets and content bodies are excluded./)).toBeInTheDocument();
    expect(api.diagnostics.export).toHaveBeenCalledWith('prj_abcdefgh');
  });
});


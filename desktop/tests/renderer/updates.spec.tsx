import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Updates } from '../../src/renderer/components/Updates.js';
import { mockApi } from './fixtures.js';

const component = {
  id: 'desktop',
  displayName: 'Qortal Migration Studio (Desktop)',
  version: '0.9.0-alpha.1',
  channel: 'alpha',
  releaseTag: 'v0.9.0-alpha.1',
  releaseDate: '2026-11-05T05:00:00.000Z',
  releaseUrl: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.9.0-alpha.1',
  changelog: { summary: 'Desktop update check and safer packaging.' },
  supportedPlatforms: ['linux-x64'],
  minimumDependencies: {},
  install: { kind: 'debian-package', instructions: 'Download the .deb and install it with apt.' },
  artifacts: [{
    platform: 'linux-x64', format: 'deb',
    name: 'qortal-migration-studio_0.9.0~alpha.1_amd64.deb',
    bytes: 34567890,
    sha256: 'b'.repeat(64),
    url: 'https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.9.0-alpha.1/qortal-migration-studio_0.9.0~alpha.1_amd64.deb'
  }]
};

function updateState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'update_available', componentId: 'desktop', installedVersion: '0.8.0-alpha.1',
    checkedAt: Date.parse('2026-11-05T06:00:00.000Z'), stale: false, showBadge: true,
    reason: 'Version 0.9.0-alpha.1 is available.', component, artifact: component.artifacts[0],
    ...overrides
  } as never;
}

describe('desktop update UI', () => {
  it('shows a badge only for a verified update and opens the full details', async () => {
    const api = mockApi({
      updates: {
        state: vi.fn(async () => updateState()),
        check: vi.fn(async () => updateState()),
        setNode: vi.fn(async () => updateState()),
        openRelease: vi.fn(async () => ({ ok: true }))
      }
    } as never);
    window.qms = api;
    render(<Updates />);
    const badge = await screen.findByRole('button', { name: 'Update available' });
    fireEvent.click(badge);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Available/)).toHaveTextContent('0.9.0-alpha.1');
    expect(screen.getByText('b'.repeat(64))).toBeTruthy();
    expect(screen.getByText(/Download the .deb/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(api.updates.check).toHaveBeenCalled());
  });

  it('does not show a badge when the check is unavailable', async () => {
    window.qms = mockApi({
      updates: {
        state: vi.fn(async () => updateState({ status: 'unable_to_check', showBadge: false, component: undefined, artifact: undefined, reason: 'Unable to check for updates: offline.' })),
        check: vi.fn(async () => updateState({ status: 'unable_to_check', showBadge: false })),
        setNode: vi.fn(async () => updateState()),
        openRelease: vi.fn(async () => ({ ok: true }))
      }
    } as never);
    render(<Updates />);
    await screen.findByRole('button', { name: 'Updates' });
    expect(screen.queryByRole('button', { name: 'Update available' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
    expect(screen.getByText(/Startup and normal migration work are not blocked/)).toBeTruthy();
  });
});

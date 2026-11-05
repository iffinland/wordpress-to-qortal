import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UpdateDialog } from '../src/components/UpdateDialog';
import { Layout } from '../src/components/Layout';
import { cmsConfig } from '../src/config/cmsConfig';
import type { UpdateCheckerState } from '../../../lib/update/registry.js';

const component = {
  id: 'cms' as const,
  displayName: 'Generic CMS',
  version: '0.9.0-alpha.1',
  channel: 'alpha' as const,
  releaseTag: 'v0.9.0-alpha.1',
  releaseDate: '2026-11-05T05:00:00.000Z',
  releaseUrl: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.9.0-alpha.1',
  changelog: { summary: 'New gallery and safer editor.', url: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.9.0-alpha.1' },
  supportedPlatforms: ['qortal-hub'],
  minimumDependencies: {},
  install: { kind: 'qapp-zip' as const, instructions: 'Preserve qms-cms-config.json and republish the APP.' },
  artifacts: [{
    platform: 'qortal-hub',
    format: 'zip' as const,
    name: 'qortal-migration-generic-cms-v0.9.0-alpha.1.zip',
    bytes: 2345678,
    sha256: 'a'.repeat(64),
    url: 'https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.9.0-alpha.1/qortal-migration-generic-cms-v0.9.0-alpha.1.zip'
  }]
};

function state(overrides: Partial<UpdateCheckerState> = {}): UpdateCheckerState {
  return {
    status: 'update_available',
    componentId: 'cms',
    installedVersion: '0.8.0-alpha.1',
    checkedAt: Date.parse('2026-11-05T05:30:00.000Z'),
    stale: false,
    showBadge: true,
    reason: 'Version 0.9.0-alpha.1 is available.',
    installedChannel: 'alpha',
    latestChannel: 'alpha',
    latestVersion: '0.9.0-alpha.1',
    component,
    artifact: component.artifacts[0],
    ...overrides
  } as UpdateCheckerState;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Generic CMS update view', () => {
  it('shows installed and available versions, changelog, hash and deployment steps', () => {
    render(
      <UpdateDialog
        state={state()}
        open
        onClose={() => {}}
        onCheck={() => {}}
        customized={false}
        hasPublishedSettings={false}
      />
    );
    expect(screen.getByText(/Installed template/).textContent).toContain('0.8.0-alpha.1');
    expect(screen.getByText(/Update available:/).textContent).toContain('0.9.0-alpha.1');
    expect(screen.getByText('New gallery and safer editor.')).toBeTruthy();
    expect(screen.getByText('a'.repeat(64))).toBeTruthy();
    expect(screen.getByText(/Preserve qms-cms-config.json/)).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('warns that a generic ZIP must not overwrite a customized CMS', () => {
    render(
      <UpdateDialog
        state={state()}
        open
        onClose={() => {}}
        onCheck={() => {}}
        customized
        hasPublishedSettings
      />
    );
    expect(screen.getByText(/Do not overwrite a customized CMS/)).toBeTruthy();
  });

  it('keeps a copyable link when Hub blocks an external tab and clipboard is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <UpdateDialog
        state={state()}
        open
        onClose={() => {}}
        onCheck={() => {}}
        customized={false}
        hasPublishedSettings={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open release page' }));
    expect(screen.getByText(/Hub blocked the external tab/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    expect(screen.getByText(/Select the link and copy it manually/)).toBeTruthy();
    const input = screen.getByLabelText('Release download link') as HTMLInputElement;
    expect(input.value).toContain('releases/download/v0.9.0-alpha.1');
  });

  it('renders the compact badge in the header only when the caller supplies one', () => {
    const { rerender } = render(
      <Layout config={cmsConfig} route={{ kind: 'home' }} viewer={null} templateVersion="0.8.0-alpha.1" updateBadge={<button type="button" className="update-badge">Update available</button>}>
        <div>content</div>
      </Layout>
    );
    expect(screen.getByRole('button', { name: 'Update available' })).toBeTruthy();
    rerender(
      <Layout config={cmsConfig} route={{ kind: 'home' }} viewer={null} templateVersion="0.8.0-alpha.1">
        <div>content</div>
      </Layout>
    );
    expect(screen.queryByRole('button', { name: 'Update available' })).toBeNull();
  });

  it('explains unavailable and unverified states without an update badge', () => {
    render(
      <UpdateDialog
        state={state({ status: 'unable_to_check', showBadge: false, component: undefined, artifact: undefined, reason: 'Unable to check for updates: offline.' })}
        open
        onClose={() => {}}
        onCheck={() => {}}
        customized={false}
        hasPublishedSettings={false}
      />
    );
    expect(screen.getByText('Unable to check for updates')).toBeTruthy();
    expect(screen.getByText(/Normal CMS operation continues/)).toBeTruthy();
    expect(screen.queryByText(/Verified download/)).toBeNull();
  });
});

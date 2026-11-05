import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { App } from '../src/App';
import { GalleryPage } from '../src/pages/GalleryPage';
import { AdminPage } from '../src/pages/AdminPage';
import { SettingsPanel } from '../src/pages/admin/SettingsPanel';
import { GalleryAdmin } from '../src/pages/admin/GalleryAdmin';
import { cmsConfig } from '../src/config/cmsConfig';
import { ownerIdentity, readerIdentity, loadFixture } from './support/fixtures';
import type { CmsDataset, Gallery } from '../src/types';

const gallery: Gallery = {
  id: 'g1', slug: 'trip', title: 'Trip', description: 'A trip', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  images: [
    { service: 'IMAGE', name: 'developer iffi', identifier: 'img-one', caption: 'First', alt: 'First' },
    { service: 'IMAGE', name: 'developer iffi', identifier: 'img-two', caption: 'Second', alt: 'Second' }
  ]
};

let dataset: CmsDataset;
beforeAll(async () => { dataset = (await loadFixture()).dataset; });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });

describe('theme switcher interaction', () => {
  it('applies light mode instantly, persists it, and updates the control state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    render(<App />);
    const light = screen.getByLabelText('Use light theme');
    fireEvent.click(light);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(JSON.parse(localStorage.getItem('qms-cms-theme@1') || '{}').mode).toBe('light');
    expect(light.getAttribute('aria-pressed')).toBe('true');
    const dark = screen.getByLabelText('Use dark theme');
    fireEvent.click(dark);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });
});

describe('gallery viewer interaction', () => {
  it('opens full screen, navigates with arrows, and closes with Escape while restoring focus', async () => {
    render(<GalleryPage galleries={[gallery]} slug="trip" />);
    const opener = screen.getByRole('button', { name: /First, open full screen/ });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('owner-only administration interaction', () => {
  it('shows Access denied and no admin controls for a non-owner, even on direct navigation', () => {
    render(
      <AdminPage dataset={dataset} identity={readerIdentity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: false, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} />
    );
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(screen.queryByText('Site settings')).toBeNull();
    expect(screen.queryByText('Import and adoption')).toBeNull();
    expect(screen.queryByText('Galleries')).toBeNull();
  });

  it('offers an explicit Connect owner account action without opening admin', () => {
    const onConnect = vi.fn();
    const identity = { ...readerIdentity, address: '', reason: 'no-account', action: 'connect' as const, nameRecordStatus: 'none' as const, message: 'No active Qortal account was returned.' };
    render(
      <AdminPage dataset={dataset} identity={identity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: false, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} onConnectOwner={onConnect} />
    );
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(screen.getByText(/No active Qortal account was returned/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect owner account' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Site settings')).toBeNull();
  });

  it('distinguishes a registry failure from a permission failure', () => {
    const identity = { ...readerIdentity, address: '', reason: 'name-record-unavailable', action: 'retry' as const, nameRecordStatus: 'unavailable' as const, message: 'The Qortal name registry could not be read.' };
    render(
      <AdminPage dataset={dataset} identity={identity} identityLoading={false} identityNotice="" adoptionQueue={[]} onAdopt={() => ({ ok: false, message: '' })} onRemove={() => undefined} onRefresh={() => undefined} onRetryIdentity={vi.fn()} />
    );
    expect(screen.getByText(/not a permission problem/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry ownership check' })).toBeTruthy();
    expect(screen.queryByText('Site settings')).toBeNull();
  });

  it('shows the settings publication destination and fee before any signature', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    render(
      <SettingsPanel config={cmsConfig} identity={ownerIdentity} qdnName="developer iffi" siteId="site" remoteSettings={null} onPreview={() => undefined} onPublished={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Publish settings/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/DOCUMENT \/ developer iffi \/ qms-cms-site-settings/)).toBeTruthy();
    expect(within(dialog).getByText(/Fee/)).toBeTruthy();
  });

  it('limits a gallery file batch to 10 and says how many were not added', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    render(
      <GalleryAdmin identity={ownerIdentity} name="developer iffi" siteId="site" dataset={dataset} galleries={[]} onRefresh={() => undefined} />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'New gallery' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'New gallery' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from({ length: 11 }, (_, index) => new File(['x'], 'image-' + index + '.png', { type: 'image/png' }));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fireEvent.change(input);
    expect(screen.getByText(/Selected 10 of 10/)).toBeTruthy();
    expect(screen.getByText(/1 file\(s\) were not added/)).toBeTruthy();
  });
});


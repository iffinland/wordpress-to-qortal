import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GalleryAdmin } from '../src/pages/admin/GalleryAdmin';
import { SettingsPanel } from '../src/pages/admin/SettingsPanel';
import { cmsConfig } from '../src/config/cmsConfig';
import { ownerIdentity } from './support/fixtures';
import type { Gallery } from '../src/types';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const gallery: Gallery = {
  id: 'g1',
  slug: 'trip',
  title: 'Trip',
  description: 'A trip',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  images: [
    { service: 'IMAGE', name: 'developer iffi', identifier: 'img-one', caption: 'First', alt: 'First' },
    { service: 'IMAGE', name: 'developer iffi', identifier: 'img-two', caption: 'Second', alt: 'Second' },
    { service: 'IMAGE', name: 'developer iffi', identifier: 'img-three', caption: 'Third', alt: 'Third' }
  ]
};

function stubNetwork() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
}

describe('gallery editing', () => {
  it('keeps the published gallery slug when the title changes', async () => {
    stubNetwork();
    render(<GalleryAdmin identity={ownerIdentity} name="developer iffi" siteId="site" dataset={null} galleries={[gallery]} onRefresh={() => undefined} />);
    await screen.findByRole('button', { name: 'New gallery' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit / add batch' }));
    const title = screen.getByLabelText('Gallery title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    expect(slug.value).toBe('trip');
    fireEvent.change(title, { target: { value: 'Trip renamed' } });
    expect(slug.value).toBe('trip');
  });

  it('generates a full slug for a new gallery and avoids duplicates', async () => {
    stubNetwork();
    render(<GalleryAdmin identity={ownerIdentity} name="developer iffi" siteId="site" dataset={null} galleries={[gallery]} onRefresh={() => undefined} />);
    await screen.findByRole('button', { name: 'New gallery' });
    fireEvent.click(screen.getByRole('button', { name: 'New gallery' }));
    const title = screen.getByLabelText('Gallery title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    const typed = 'Trip';
    for (let index = 1; index <= typed.length; index += 1) {
      fireEvent.change(title, { target: { value: typed.slice(0, index) } });
    }
    expect(slug.value).toBe('trip-2');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate slug' }));
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('trip-2');
  });

  it('edits captions, alt text, order and gallery membership without duplicating the gallery', async () => {
    stubNetwork();
    render(<GalleryAdmin identity={ownerIdentity} name="developer iffi" siteId="site" dataset={null} galleries={[gallery]} onRefresh={() => undefined} />);
    await screen.findByRole('button', { name: 'New gallery' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit / add batch' }));

    const captions = screen.getAllByLabelText('Caption') as HTMLInputElement[];
    fireEvent.change(captions[0], { target: { value: 'First updated' } });
    expect((screen.getAllByLabelText('Caption')[0] as HTMLInputElement).value).toBe('First updated');

    const alts = screen.getAllByLabelText('Alt text') as HTMLInputElement[];
    fireEvent.change(alts[0], { target: { value: 'Accessible first' } });
    expect((screen.getAllByLabelText('Alt text')[0] as HTMLInputElement).value).toBe('Accessible first');

    const before = screen.getAllByLabelText('Caption').map((input) => (input as HTMLInputElement).value);
    fireEvent.click(screen.getByRole('button', { name: 'Move image 2 up' }));
    const after = screen.getAllByLabelText('Caption').map((input) => (input as HTMLInputElement).value);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.getAllByLabelText('Caption')).toHaveLength(2);
    // Identity is the gallery id, so publishing updates the same gallery.
    expect(screen.getAllByText(/Images in this gallery/)[0].textContent).toContain('2');
  });
});

describe('settings editing and unsaved guard', () => {
  it('marks changes as unsaved and reverts to the published settings', async () => {
    stubNetwork();
    render(
      <SettingsPanel
        config={cmsConfig as any}
        identity={ownerIdentity}
        qdnName="QortalDemo"
        siteId="site"
        remoteSettings={null}
        onPreview={() => undefined}
        onPublished={() => undefined}
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Publish settings/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Site title'), { target: { value: 'Changed title' } });
    expect(screen.getByText(/Unsaved settings changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert to published' }));
    expect(screen.queryByText(/Unsaved settings changes/)).toBeNull();
    expect((screen.getByLabelText('Site title') as HTMLInputElement).value).toBe(cmsConfig.site.title);
    expect(screen.getByText(/Reverted to the last published settings/)).toBeTruthy();
  });

  it('shows the footer and identity fields that owners can edit', async () => {
    stubNetwork();
    render(
      <SettingsPanel
        config={cmsConfig as any}
        identity={ownerIdentity}
        qdnName="QortalDemo"
        siteId="site"
        remoteSettings={null}
        onPreview={() => undefined}
        onPublished={() => undefined}
      />
    );
    await waitFor(() => expect(screen.getByLabelText('Tagline')).toBeTruthy());
    expect(screen.getByLabelText('Public author name')).toBeTruthy();
    expect(screen.getByLabelText(/Footer text/)).toBeTruthy();
  });
});

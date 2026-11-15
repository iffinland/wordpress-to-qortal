import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsPanel } from '../src/pages/admin/SettingsPanel';
import { cmsConfig } from '../src/config/cmsConfig';
import { ownerIdentity } from './support/fixtures';

const publishSettings = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/authoring.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/authoring.js')>()),
  publishSettingsDraft: publishSettings
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  publishSettings.mockReset();
  document.body.style.overflow = '';
});

function renderPanel(onPublished = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
  render(
    <SettingsPanel config={cmsConfig} identity={ownerIdentity} qdnName="developer iffi" siteId="site" remoteSettings={null} onPreview={() => undefined} onPublished={onPublished} />
  );
  const button = screen.getByRole('button', { name: /Publish settings/ });
  button.focus();
  fireEvent.click(button);
  return { button, onPublished };
}

describe('settings publish lifecycle inside the shared dialog', () => {
  it('shows progress then success inside the dialog and returns focus to Publish settings', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    publishSettings.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { button, onPublished } = renderPanel();
    const dialog = screen.getByRole('dialog', { name: 'Confirm settings publication' });
    expect(within(dialog).getByText(/qms-cms-site-settings/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    const progress = await screen.findByRole('dialog', { name: 'Publishing…' });
    expect(within(progress).getByRole('status').textContent).toContain('Qortal Hub approval');

    await act(async () => { resolve({ ok: true, state: 'remote-verified', message: 'Published and verified byte-for-byte.', document: { revision: 1 } }); });
    const done = await screen.findByRole('dialog', { name: 'Published and verified' });
    expect(within(done).getByRole('status').textContent).toContain('Published and verified byte-for-byte.');
    expect(onPublished).toHaveBeenCalledTimes(1);
    fireEvent.click(within(done).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('shows a revision conflict as an alert inside the dialog', async () => {
    publishSettings.mockResolvedValue({ ok: false, state: 'conflict', message: 'Settings moved from revision 1 to 2.' });
    renderPanel();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm publish' }));
    const failed = await screen.findByRole('dialog', { name: 'Not published' });
    expect(within(failed).getByRole('alert').textContent).toContain('Settings moved from revision 1 to 2.');
    expect(screen.queryAllByText(/Settings moved from revision 1 to 2\./).length).toBe(1);
  });

  it('keeps ambiguous results inside the dialog, never resends, and Escape closes it', async () => {
    publishSettings.mockResolvedValue({ ok: false, state: 'ambiguous', message: 'Read-back not confirmed. It was NOT resent.' });
    const { button } = renderPanel();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm publish' }));
    const result = await screen.findByRole('dialog', { name: 'Publication unconfirmed' });
    expect(within(result).getByRole('alert').textContent).toContain('not retried automatically');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(publishSettings).toHaveBeenCalledTimes(1);
  });

  it('Escape while confirming cancels without publishing', () => {
    const { button } = renderPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(publishSettings).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });
});

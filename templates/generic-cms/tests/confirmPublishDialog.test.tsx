import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmPublishDialog, type PublishPhase } from '../src/components/ConfirmPublishDialog';
import { EditorPage } from '../src/pages/admin/EditorPage';
import { loadFixture, ownerIdentity } from './support/fixtures';
import { normalizeContentPayload } from '../src/lib/manifest.js';
import type { CmsContentItem, CmsDataset } from '../src/types';

const publishNative = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/authoring.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/authoring.js')>()),
  publishNativePostDraft: publishNative
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  publishNative.mockReset();
  document.body.style.overflow = '';
});

function Harness(props: { phase?: PublishPhase; onCancel?: () => void; onClose?: () => void; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open publish</button>
      {open ? (
        <ConfirmPublishDialog
          title="Confirm test publication"
          phase={props.phase || 'confirm'}
          statusMessage="Status text from the caller."
          onConfirm={props.onConfirm || (() => undefined)}
          onCancel={() => { props.onCancel?.(); setOpen(false); }}
          onClose={() => { props.onClose?.(); setOpen(false); }}
        >
          <p>Summary body</p>
        </ConfirmPublishDialog>
      ) : null}
    </div>
  );
}

describe('ConfirmPublishDialog focus handling', () => {
  it('is a labelled modal dialog and moves focus into it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open publish' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm test publication' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('traps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open publish' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm publish' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });

    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);

    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    // Focus that escapes the dialog is pulled back in.
    const opener = screen.getByRole('button', { name: 'Open publish' });
    opener.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape while confirming and returns focus to the opener', () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Open publish' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('ignores Escape while a signature request is in flight', () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    render(<Harness phase="publishing" onCancel={onCancel} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open publish' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).queryByRole('button')).toBeNull();
  });
});

describe('ConfirmPublishDialog lifecycle status stays inside the dialog', () => {
  const cases: Array<[PublishPhase, string, 'alert' | 'status']> = [
    ['publishing', 'Publishing…', 'status'],
    ['success', 'Published and verified', 'status'],
    ['partial', 'Published, one step pending', 'status'],
    ['ambiguous', 'Publication unconfirmed', 'alert'],
    ['error', 'Not published', 'alert']
  ];
  for (const [phase, heading, role] of cases) {
    it('shows the ' + phase + ' phase with its status message inside the dialog', () => {
      const onClose = vi.fn();
      render(<Harness phase={phase} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open publish' }));
      const dialog = screen.getByRole('dialog', { name: heading });
      const status = within(dialog).getByRole(role);
      expect(status.textContent).toContain(phase === 'publishing' ? 'Keep this window open' : 'Status text from the caller.');
      expect(within(dialog).getByText('Summary body')).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: 'Confirm publish' })).toBeNull();
      if (phase !== 'publishing') {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    });
  }
});

describe('post editor publish lifecycle inside the dialog', () => {
  let dataset: CmsDataset;
  let payloads: Record<string, any>;

  beforeAll(async () => {
    dataset = (await loadFixture()).dataset;
    payloads = {
      'qms-fixture-post-hello': (await import('../fixtures/content/post-hello.json')).default
    };
  });

  async function openNativeConfirm() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const hello = dataset.posts.find((item) => item.id === 'post-hello') as CmsContentItem;
    const target = { ...dataset, posts: [...dataset.posts, { ...hello, id: 'cms-1', native: true, title: 'CMS existing', slug: 'cms-existing', legacy: undefined }] };
    render(
      <EditorPage
        identity={ownerIdentity}
        name="QortalDemo"
        siteId="site-fixture"
        dataset={target}
        galleries={[]}
        loadContent={async (item) => normalizeContentPayload(payloads[item.contentRef ? item.contentRef.identifier : ''], item) as any}
        onRefresh={() => undefined}
      />
    );
    await screen.findByRole('button', { name: 'New post' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit CMS existing' }));
    await screen.findByLabelText('Title');
    const publishButton = screen.getByRole('button', { name: 'Publish post…' });
    publishButton.focus();
    fireEvent.click(publishButton);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm post publication' });
    return { dialog, publishButton };
  }

  it('shows progress, then success, inside the same dialog and returns focus to Publish', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    publishNative.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { dialog, publishButton } = await openNativeConfirm();
    expect(within(dialog).getByText('Title')).toBeTruthy();
    expect(within(dialog).getByText('Fee')).toBeTruthy();
    expect(within(dialog).getByText('Signer')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    const progress = await screen.findByRole('dialog', { name: 'Publishing…' });
    expect(progress).toBe(dialog);
    expect(within(progress).getByRole('status').textContent).toContain('Qortal Hub approval');
    expect(within(progress).queryByRole('button')).toBeNull();
    // The page itself must not duplicate the message while the dialog is open.
    expect(screen.queryAllByText(/waiting for Qortal Hub approval/i).length).toBe(1);

    await act(async () => {
      resolve({ ok: true, state: 'remote-verified', index: { revision: 4 }, contentIdentifier: 'cms-existing-id', slugAliases: [], entry: { id: 'cms-1' } });
    });
    const done = await screen.findByRole('dialog', { name: 'Published and verified' });
    expect(within(done).getByRole('status').textContent).toContain('Published and verified byte-for-byte');
    fireEvent.click(within(done).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(publishButton);
    // After closing, the result also remains next to the toolbar.
    expect(screen.getAllByText(/Published and verified byte-for-byte/).length).toBeGreaterThan(0);
  });

  it('shows an ambiguous result as an alert inside the dialog and never resends by itself', async () => {
    publishNative.mockResolvedValue({ ok: false, state: 'ambiguous', message: 'Submitted, but read-back did not match yet. It was NOT resent.' });
    const { dialog } = await openNativeConfirm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    const result = await screen.findByRole('dialog', { name: 'Publication unconfirmed' });
    const alert = within(result).getByRole('alert');
    expect(alert.textContent).toContain('It was NOT resent.');
    expect(alert.textContent).toContain('not resent automatically');
    expect(publishNative).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(/It was NOT resent\./).length).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(publishNative).toHaveBeenCalledTimes(1);
  });

  it('shows an error inside the dialog and lets Escape cancel the confirmation without publishing', async () => {
    publishNative.mockResolvedValue({ ok: false, state: 'failed', message: 'Ownership could not be verified.' });
    const { dialog, publishButton } = await openNativeConfirm();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(publishNative).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(publishButton);

    fireEvent.click(publishButton);
    const again = await screen.findByRole('dialog', { name: 'Confirm post publication' });
    fireEvent.click(within(again).getByRole('button', { name: 'Confirm publish' }));
    const failed = await screen.findByRole('dialog', { name: 'Not published' });
    expect(within(failed).getByRole('alert').textContent).toContain('Ownership could not be verified.');
    expect(dialog).toBeTruthy();
  });
});

import { Blob as NodeBlob } from 'node:buffer';
import { Sha256 } from '../src/lib/sha256Stream.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorPage } from '../src/pages/admin/EditorPage';
import { loadFixture, ownerIdentity } from './support/fixtures';
import { normalizeContentPayload } from '../src/lib/manifest.js';
import type { CmsContentItem, CmsDataset } from '../src/types';

const publishNative = vi.hoisted(() => vi.fn());
const publishOverlay = vi.hoisted(() => vi.fn());
const captureFile = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/attachmentCapture.js', () => ({ captureAttachment: captureFile }));
vi.mock('../src/lib/authoring.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/authoring.js')>()),
  publishNativePostDraft: publishNative,
  publishOverlayDraft: publishOverlay
}));

let dataset: CmsDataset;
let payloads: Record<string, any>;

beforeAll(async () => {
  dataset = (await loadFixture()).dataset;
  payloads = {
    'qms-fixture-post-hello': (await import('../fixtures/content/post-hello.json')).default
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  publishNative.mockReset();
  publishOverlay.mockReset();
  captureFile.mockReset();
});

async function openNativeEditor(config?: any) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  const hello = dataset.posts.find((item) => item.id === 'post-hello') as CmsContentItem;
  const target = {
    ...dataset,
    posts: [...dataset.posts, { ...hello, id: 'cms-1', native: true, title: 'CMS existing', slug: 'cms-existing', legacy: undefined }]
  };
  render(
    <EditorPage
      identity={ownerIdentity}
      name="QortalDemo"
      siteId="site-fixture"
      dataset={target}
      galleries={[]}
      config={config}
      loadContent={async (item) => normalizeContentPayload(payloads[item.contentRef ? item.contentRef.identifier : ''], item) as any}
      onRefresh={() => undefined}
    />
  );
  await screen.findByRole('button', { name: 'New post' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit CMS existing' }));
  await screen.findByLabelText('Title');
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish post…' }));
  return await screen.findByRole('dialog', { name: 'Confirm post publication' });
}

describe('optional cross-publication destinations in the post editor', () => {
  it('shows three unchecked destinations and keeps Q-Tube unavailable without a video', async () => {
    await openNativeEditor();
    const qtube = screen.getByLabelText('Publish to Q-Tube') as HTMLInputElement;
    const subwire = screen.getByLabelText('Publish to Subwire') as HTMLInputElement;
    const quitter = screen.getByLabelText('Publish to Quitter') as HTMLInputElement;
    expect(qtube.checked).toBe(false);
    expect(subwire.checked).toBe(false);
    expect(quitter.checked).toBe(false);
    expect(qtube.disabled).toBe(true);
    expect(screen.getByText(/No eligible video attachment/)).toBeTruthy();
  });

  it('keeps normal CMS publishing unchanged when no destination is selected', async () => {
    publishNative.mockResolvedValue({ ok: true, state: 'remote-verified', index: { revision: 1 }, entry: { id: 'cms-1' }, contentIdentifier: 'id' });
    await openNativeEditor();
    const dialog = await openDialog();
    expect(within(dialog).queryByText('Also publishing')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    await screen.findByRole('dialog', { name: 'Published and verified' });
    expect(publishNative).toHaveBeenCalledTimes(1);
    expect(publishNative.mock.calls[0][0].extraResources).toEqual([]);
  });

  it('prefills the Quitter announcement, lists every destination before approval and reports each result', async () => {
    publishNative.mockResolvedValue({
      ok: true,
      state: 'remote-verified',
      index: { revision: 4 },
      entry: { id: 'cms-1' },
      contentIdentifier: 'cms-existing-id',
      slugAliases: [],
      batchResults: [
        { stage: 'subwire', ok: true, state: 'remote-verified' },
        { stage: 'quitter', ok: true, state: 'remote-verified' },
        { stage: 'content', ok: true, state: 'remote-verified' },
        { stage: 'index', ok: true, state: 'remote-verified' },
        { stage: 'search', ok: true, state: 'remote-verified' }
      ]
    });
    await openNativeEditor();
    fireEvent.click(screen.getByLabelText('Publish to Subwire'));
    fireEvent.click(screen.getByLabelText('Publish to Quitter'));

    const textarea = await screen.findByLabelText('Quitter announcement text') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain('New publication:'));
    expect(textarea.value).toContain('qortal://APP/QortalDemo/#/posts/cms-existing');
    fireEvent.change(textarea, { target: { value: 'My custom announcement with a link qortal://APP/QortalDemo/#/posts/cms-existing' } });

    const dialog = await openDialog();
    expect(within(dialog).getByText('Also publishing')).toBeTruthy();
    const resources = within(dialog).getByRole('list', { name: 'Destination resources' });
    expect(within(resources).getAllByText(/Subwire/).length).toBeGreaterThan(0);
    expect(within(resources).getAllByText(/Quitter/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/Q-Tube/)).toBeNull();
    expect(dialog.textContent).toContain('My custom announcement with a link');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    const done = await screen.findByRole('dialog', { name: 'Published and verified' });
    const results = within(done).getByRole('list', { name: 'Results per destination' });
    expect(within(results).getByText(/CMS post/)).toBeTruthy();
    expect(within(results).getByText(/Subwire/)).toBeTruthy();
    expect(within(results).getByText(/Quitter/)).toBeTruthy();
    expect(publishNative).toHaveBeenCalledTimes(1);
    const extra = publishNative.mock.calls[0][0].extraResources;
    expect(extra.map((entry: any) => entry.stage)).toEqual(['subwire', 'quitter', 'crosspost-record']);
    expect(extra[1].document.text).toBe('My custom announcement with a link qortal://APP/QortalDemo/#/posts/cms-existing');
  });

  it('builds the announcement link from the effective runtime deployment', async () => {
    await openNativeEditor({
      deployment: { service: 'APP', name: 'QortalDemo', identifier: 'qms-site' },
      site: { title: 'Qortal Site' },
      theme: { colors: { accent: '#4da3ff' } }
    });
    fireEvent.click(screen.getByLabelText('Publish to Quitter'));
    const textarea = await screen.findByLabelText('Quitter announcement text') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain('qortal://APP/QortalDemo/?identifier=qms-site#/posts/cms-existing'));
  });

  it('reports a failed destination separately while keeping the CMS post published', async () => {
    publishNative.mockResolvedValue({
      ok: false,
      state: 'partial',
      message: 'Qortal Hub reported that one resource was not published.',
      index: { revision: 5 },
      entry: { id: 'cms-1' },
      contentIdentifier: 'cms-existing-id',
      slugAliases: [],
      batchResults: [
        { stage: 'subwire', ok: false, state: 'failed', message: 'Qortal Hub reported that subwire was not published.' },
        { stage: 'content', ok: true, state: 'remote-verified' },
        { stage: 'index', ok: true, state: 'remote-verified' },
        { stage: 'search', ok: true, state: 'remote-verified' }
      ]
    });
    await openNativeEditor();
    fireEvent.click(screen.getByLabelText('Publish to Subwire'));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm publish' }));
    const partial = await screen.findByRole('dialog', { name: 'Published, one step pending' });
    const results = within(partial).getByRole('list', { name: 'Results per destination' });
    expect(within(results).getByText(/CMS post/).closest('li')?.textContent).toContain('published and verified');
    expect(within(results).getByText(/Subwire/).closest('li')?.textContent).toContain('not published');
    expect(partial.textContent).toContain('Destination results');
    fireEvent.click(within(partial).getByRole('button', { name: 'Close' }));
    expect(screen.getAllByText(/Destination results/).length).toBeGreaterThan(0);
  });

  it('blocks publication when the edited announcement exceeds the Quitter limit', async () => {
    await openNativeEditor();
    fireEvent.click(screen.getByLabelText('Publish to Quitter'));
    const textarea = await screen.findByLabelText('Quitter announcement text') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(400) } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish post…' }));
    await waitFor(() => expect(screen.getAllByText(/Quitter shows at most 280/).length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(publishNative).not.toHaveBeenCalled();
  });
});


describe('file attachments through the real editor and confirmation dialog', () => {
  async function attachVideo() {
    const bytes = new Uint8Array([4, 3, 2, 1]);
    const sha256 = new Sha256().update(bytes).hex();
    const capture = { ok: true, kind: 'video', service: 'VIDEO', filename: 'QMS-manual-unofficial.mp4', title: 'QMS manual', mime: 'video/mp4', size: 4, sha256, identifier: 'qms-cms-att-' + sha256.slice(0, 32), blob: new NodeBlob([bytes]), poster: null, posterIdentifier: '' };
    captureFile.mockResolvedValue(capture);
    fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [new File(['test'], capture.filename, {type: 'video/mp4'})] } });
    await screen.findByText(/Attached "QMS-manual-unofficial.mp4"/);
    return capture;
  }
  it.each([false,true])('publishes a fresh video in one CMS plan, Q-Tube selected: %s', async qtube => {
    publishNative.mockImplementation(async request => ({ ok: true, index: {revision:1}, entry:{id:'cms-1'}, contentIdentifier:'post-id', batchResults: [...request.extraResources.map((r:any)=>({stage:r.stage,identifier:r.identifier,ok:true,state:'remote-verified'})), ...['content','index','search'].map(stage=>({stage,ok:true,state:'remote-verified'}))] }));
    await openNativeEditor();
    const capture = await attachVideo();
    if(qtube) fireEvent.click(screen.getByLabelText('Publish to Q-Tube'));
    const dialog = await openDialog();
    expect(publishNative).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', {name:'Confirm publish'}));
    await screen.findByRole('dialog', {name:'Published and verified'});
    expect(publishNative).toHaveBeenCalledTimes(1);
    const request=publishNative.mock.calls[0][0];
    const videos=request.extraResources.filter((r:any)=>r.service==='VIDEO');
    expect(videos).toHaveLength(1);expect(videos[0].file).toBe(capture.blob);
    expect(videos[0].identifier.startsWith(qtube?'qtube_vid_':'qms-cms-att-')).toBe(true);
    expect(request.draft.html).toContain('data-identifier="'+videos[0].identifier+'"');
    expect(request.extraResources.some((r:any)=>r.stage==='qtube')).toBe(qtube);
    if(qtube) expect(videos[0].verifyFileHash).toBe(true);
  });
  it.each(['new', 'imported'])('adds video through the %s post publication path', async source => {
    publishNative.mockResolvedValue({ok:true,index:{revision:1},entry:{id:'new-post'}});
    publishOverlay.mockResolvedValue({ok:true,overlay:{revision:1,entries:[]}});
    await openNativeEditor();
    fireEvent.click(screen.getByRole('button',{name:'← All posts'}));
    if(source==='new') {
      fireEvent.click(screen.getByRole('button',{name:'New post'}));
      fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Video post'}});
    } else {
      fireEvent.click(screen.getByRole('button',{name:'Edit Hello Qortal'}));
      await screen.findByLabelText('Title');
    }
    await attachVideo();
    const dialog=await openDialog();fireEvent.click(within(dialog).getByRole('button',{name:'Confirm publish'}));
    await screen.findByRole('dialog',{name:'Published and verified'});
    const publish=source==='new'?publishNative:publishOverlay;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].extraResources.filter((r:any)=>r.service==='VIDEO')).toHaveLength(1);
    if(source==='imported') expect(publishNative).not.toHaveBeenCalled();
  });
  it('retains the exact publication timestamp and files after an unconfirmed attempt', async () => {
    publishNative.mockResolvedValueOnce({ok:false,state:'ambiguous',message:'Pending upload'}).mockResolvedValueOnce({ok:true,index:{revision:1},entry:{id:'cms-1'}});
    await openNativeEditor();await attachVideo();
    const first=await openDialog();fireEvent.click(within(first).getByRole('button',{name:'Confirm publish'}));
    const pending=await screen.findByRole('dialog',{name:'Publication unconfirmed'});
    fireEvent.click(within(pending).getByRole('button',{name:'Close'}));
    const second=await openDialog();fireEvent.click(within(second).getByRole('button',{name:'Confirm publish'}));
    await screen.findByRole('dialog',{name:'Published and verified'});
    const a=publishNative.mock.calls[0][0], b=publishNative.mock.calls[1][0];
    expect(a.draft.publishTimestamp).toBeTruthy();
    expect(b.draft.publishTimestamp).toBe(a.draft.publishTimestamp);
    expect(a.extraResources[0].sha256).toBe(b.extraResources[0].sha256);
  });
  it('preserves the selected file when confirmation is cancelled and reopened', async () => {
    publishNative.mockResolvedValue({ok:true,index:{revision:1},entry:{id:'cms-1'}});
    await openNativeEditor();await attachVideo();
    const dialog=await openDialog();
    fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
    expect(publishNative).not.toHaveBeenCalled();
    const retry=await openDialog();fireEvent.click(within(retry).getByRole('button',{name:'Confirm publish'}));
    await screen.findByRole('dialog',{name:'Published and verified'});
    expect(publishNative.mock.calls[0][0].extraResources.filter((r:any)=>r.service==='VIDEO')).toHaveLength(1);
  });
});

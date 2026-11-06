import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorPage } from '../src/pages/admin/EditorPage';
import { AdminPage } from '../src/pages/AdminPage';
import { loadFixture, ownerIdentity, readerIdentity } from './support/fixtures';
import { normalizeContentPayload } from '../src/lib/manifest.js';
import type { CmsContentItem, CmsDataset } from '../src/types';

let dataset: CmsDataset;
let payloads: Record<string, any>;

beforeAll(async () => {
  const fixture = await loadFixture();
  dataset = fixture.dataset;
  payloads = {
    'qms-fixture-post-hello': (await import('../fixtures/content/post-hello.json')).default,
    'qms-fixture-post-design': (await import('../fixtures/content/post-design.json')).default,
    'qms-fixture-post-history': (await import('../fixtures/content/post-history.json')).default,
    'qms-fixture-page-about': (await import('../fixtures/content/page-about.json')).default,
    'qms-fixture-page-contact': (await import('../fixtures/content/page-contact.json')).default
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function stubNetwork(overlay: any = null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (overlay && String(url).includes('qms-cms-edit-overlay')) {
      return { ok: true, status: 200, json: async () => overlay };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

function datasetWith(options: { native?: boolean; duplicate?: string; importedLegacy?: boolean } = {}) {
  const hello = dataset.posts.find((item) => item.id === 'post-hello') as CmsContentItem;
  const posts: CmsContentItem[] = dataset.posts.map((item) => {
    if (item.id !== 'post-hello') return item;
    return options.importedLegacy === false
      ? item
      : { ...item, legacy: { sourceId: 42, oldUrl: 'https://old.example/hello-qortal/' } };
  });
  if (options.native) {
    posts.push({ ...hello, id: 'cms-1', native: true, title: 'CMS existing', slug: 'cms-existing', legacy: undefined });
  }
  if (options.duplicate) {
    posts.push({ ...hello, id: 'dup-1', native: false, title: 'Duplicate', slug: options.duplicate, legacy: undefined });
  }
  return { ...dataset, posts };
}

async function loadContent(item: CmsContentItem) {
  const identifier = item.contentRef ? item.contentRef.identifier : '';
  const payload = payloads[identifier];
  if (!payload) throw new Error('No fixture content for ' + identifier);
  return normalizeContentPayload(payload, item) as any;
}

async function renderEditor(target: CmsDataset = datasetWith()) {
  render(
    <EditorPage
      identity={ownerIdentity}
      name="QortalDemo"
      siteId="site-fixture"
      dataset={target}
      galleries={[]}
      loadContent={loadContent}
      onRefresh={() => undefined}
    />
  );
  await screen.findByRole('button', { name: 'New post' });
}

function typeTitle(input: HTMLInputElement, value: string) {
  for (let index = 1; index <= value.length; index += 1) {
    fireEvent.change(input, { target: { value: value.slice(0, index) } });
  }
}

describe('slug generation in the rendered editor', () => {
  it('generates the full slug while typing character by character', async () => {
    stubNetwork();
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;

    typeTitle(title, 'Teine test post');
    expect(slug.value).toBe('teine-test-post');
    expect(screen.getByText('teine-test-post', { selector: 'code' })).toBeTruthy();
  });

  it('handles a pasted title and Estonian letters consistently', async () => {
    stubNetwork();
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Põhja-Tallinn õäöüšž' } });
    expect(slug.value).toBe('pohja-tallinn-oaousz');
    fireEvent.change(title, { target: { value: 'Teine test post' } });
    expect(slug.value).toBe('teine-test-post');
  });

  it('stops auto-updating after a manual slug edit and supports Regenerate', async () => {
    stubNetwork();
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;

    typeTitle(title, 'Teine test');
    fireEvent.change(slug, { target: { value: 'custom-slug' } });
    fireEvent.change(title, { target: { value: 'Teine test post' } });
    expect(slug.value).toBe('custom-slug');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate slug' }));
    await waitFor(() => expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('teine-test-post'));
  });

  it('adds a deterministic suffix for duplicate titles across imported content', async () => {
    stubNetwork();
    await renderEditor(datasetWith({ duplicate: 'teine-test-post' }));
    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Teine test post' } });
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('teine-test-post-2');
  });

  it('never changes a published slug when the title is edited', async () => {
    stubNetwork();
    await renderEditor(datasetWith({ native: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit CMS existing' }));
    const title = await screen.findByLabelText('Title') as HTMLInputElement;
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toBe('cms-existing');
    fireEvent.change(title, { target: { value: 'A completely new title' } });
    expect(slug.value).toBe('cms-existing');
    expect(screen.getByText(/Locked because this item is published/)).toBeTruthy();
  });

  it('allows a published slug change only through the advanced confirmation', async () => {
    stubNetwork();
    await renderEditor(datasetWith({ native: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit CMS existing' }));
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Change slug (advanced)…' }));
    const unlock = screen.getByRole('button', { name: 'Unlock slug field' }) as HTMLButtonElement;
    expect(unlock.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I understand the consequences/));
    expect(unlock.disabled).toBe(false);
    fireEvent.click(unlock);
    const slug = screen.getByLabelText('Slug') as HTMLInputElement;
    expect(slug.disabled).toBe(false);
    fireEvent.change(slug, { target: { value: 'new-published-slug' } });
    expect(screen.getByText(/Slug will change from/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish post…' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('new-published-slug');
    expect(dialog.textContent).toContain('becomes an alias');
  });
});

describe('editing imported WordPress content', () => {
  it('loads the imported post into the editor and keeps its identity', async () => {
    stubNetwork();
    await renderEditor(datasetWith());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hello Qortal' }));
    const title = await screen.findByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Hello Qortal');
    expect(screen.getByText(/WordPress-imported post · local edit overlay/)).toBeTruthy();
    expect(screen.getByText(/Editing WordPress source #42/)).toBeTruthy();
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('hello-qortal');
  });

  it('saves a local draft without claiming publication', async () => {
    stubNetwork();
    await renderEditor(datasetWith());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hello Qortal' }));
    const title = await screen.findByLabelText('Title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Edited Hello' } });
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('hello-qortal');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText(/This is not a published update/)).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem('qms-cms-post-drafts:site-fixture') || '{}');
    expect(stored.drafts[0]).toMatchObject({ title: 'Edited Hello', publicationState: 'modified-unpublished', sourceKind: 'wordpress-overlay' });
  });

  it('previews the body with formatting preserved and warns before leaving with unsaved changes', async () => {
    stubNetwork();
    await renderEditor(datasetWith());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hello Qortal' }));
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Preview only, not published');
    expect(dialog.querySelector('strong')?.textContent).toBe('neutral fixture site');

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed title' } });
    fireEvent.click(screen.getByRole('button', { name: '← All posts' }));
    expect(screen.getByRole('heading', { name: 'Unsaved changes' })).toBeTruthy();
  });

  it('persists local drafts across a reload', async () => {
    stubNetwork();
    await renderEditor(datasetWith());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hello Qortal' }));
    await screen.findByLabelText('Title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Persisted draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    cleanup();

    stubNetwork();
    await renderEditor(datasetWith());
    expect(screen.getByRole('button', { name: /Persisted draft/ })).toBeTruthy();
    expect(screen.getByText(/Modified — not published/)).toBeTruthy();
  });

  it('shows a conflict when the WordPress source changed, with explicit choices', async () => {
    stubNetwork({
      schema: 'qms-cms-edit-overlay@1',
      version: 1,
      revision: 1,
      entries: [{
        source_item_id: 'post-hello',
        source_type: 'post',
        source_slug: 'hello-qortal',
        slug: 'hello-qortal',
        slug_aliases: [],
        title: 'My local edit',
        base_source_hash: 'sha256:definitely-not-the-current-source'
      }]
    });
    await renderEditor(datasetWith());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hello Qortal' }));
    expect(await screen.findByText(/The WordPress source changed after your edit/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep my edits' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept upstream' })).toBeTruthy();
  });

  it('reports missing and ambiguous publication states without calling them published', async () => {
    stubNetwork();
    localStorage.setItem('qms-cms-post-drafts:site-fixture', JSON.stringify({
      schema: 'qms-cms-post-drafts@1',
      version: 1,
      siteId: 'site-fixture',
      drafts: [{ id: 'd1', title: 'Unconfirmed', slug: 'unconfirmed', publicationState: 'ambiguous', sourceKind: 'cms-native' }]
    }));
    await renderEditor(datasetWith());
    expect(screen.getByText(/Publication unconfirmed — not resent/)).toBeTruthy();
  });
});

describe('authorization and navigation', () => {
  it('does not expose editing controls to a reader', () => {
    render(
      <AdminPage
        dataset={dataset}
        identity={readerIdentity}
        identityLoading={false}
        identityNotice=""
        adoptionQueue={[]}
        section="editor"
        onAdopt={() => ({ ok: false, message: '' })}
        onRemove={() => undefined}
        onRefresh={() => undefined}
      />
    );
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(screen.queryByText('New post')).toBeNull();
    expect(screen.queryByText('Imported WordPress posts and pages')).toBeNull();
  });
});

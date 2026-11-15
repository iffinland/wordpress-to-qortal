import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => {
  function make(kind: 'ready' | 'error') {
    const post = {
      id: 'cms-first', type: 'post', title: 'First post', slug: 'first-post', status: 'published',
      excerpt: 'First CMS post', categoryIds: [], tagIds: [],
      createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z', publishedAt: '2026-11-14T00:00:00.000Z',
      contentRef: { service: 'DOCUMENT', name: 'QortalMigrationStudio', identifier: 'cms-first' },
      featuredImageRef: null, featuredImageUrl: null, featuredImageAlt: null, featuredImageSource: null,
      slugAliases: [], originalSlug: null, sourceKind: 'cms-authored', native: true, legacy: null
    };
    const page = {
      id: 'cms-files', type: 'page', title: 'Files', slug: 'files', status: 'published',
      excerpt: 'Files page', categoryIds: [], tagIds: [],
      createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z', publishedAt: '2026-11-14T00:00:00.000Z',
      contentRef: { service: 'DOCUMENT', name: 'QortalMigrationStudio', identifier: 'cms-files' },
      featuredImageRef: null, featuredImageUrl: null, featuredImageAlt: null, featuredImageSource: null,
      slugAliases: [], originalSlug: null, sourceKind: 'cms-authored', native: true, legacy: null
    };
    return {
      state: kind,
      source: 'qdn',
      site: { id: 'site-fixture', title: 'Fixture Site', tagline: '', description: '', ownerName: 'QortalDemo', publicAuthor: 'Owner' },
      manifest: null,
      generatedAt: null,
      loadedAt: '2026-11-15T00:00:00.000Z',
      message: kind === 'error' ? 'CMS native index is invalid: Native index site identity does not match this CMS configuration.' : '',
      notices: kind === 'error' ? [{ code: 'catalog-unavailable', level: 'error', message: 'CMS native index is invalid.' }] : [],
      availability: { posts: kind === 'ready', pages: kind === 'ready', categories: kind === 'ready', tags: kind === 'ready' },
      posts: kind === 'ready' ? [post] : [],
      pages: kind === 'ready' ? [page] : [],
      categories: [],
      tags: [],
      media: [],
      urls: { bySourceUrl: {} }
    };
  }
  const api: any = {
    dataset: make('ready'),
    make,
    repo: {
      loadDataset: async () => api.dataset,
      loadGalleries: async () => ({ ok: true, catalog: { schema: 'qms-cms-gallery@1', version: 1, revision: 0, galleries: [] }, errors: [] }),
      findPost: async (slug: string) => api.dataset.posts.find((item: any) => item.slug === slug) || null,
      findPage: async (slug: string) => api.dataset.pages.find((item: any) => item.slug === slug) || null,
      loadContent: async (item: any) => ({ title: item.title, html: '<p>' + item.title + ' body</p>', excerptHtml: '', media: [], modifiedAt: null, author: 'Owner' }),
      loadSearchIndex: async () => ({ ok: true, state: 'ready', entries: [], updatedAt: null, notices: [] })
    }
  };
  return api;
});

vi.mock('../src/lib/repository.js', () => ({ createCmsRepository: () => state.repo }));

import { App } from '../src/App';

function navigate(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
}

beforeEach(() => {
  state.dataset = state.make('ready');
  window.location.hash = '#/';
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = '';
});

describe('public navigation through the rendered application', () => {
  it('opens Home, Posts, Archive, Search, Files and Admin with valid CMS data', async () => {
    render(<App />);
    await screen.findByText('Browse posts');

    const postsLink = screen.getByRole('link', { name: 'Posts' });
    expect(postsLink.getAttribute('href')).toBe('#/posts');
    fireEvent.click(postsLink);
    navigate('#/posts');
    await screen.findByRole('heading', { name: 'Posts' });
    expect(screen.getByText('First post')).toBeTruthy();

    navigate('#/archive');
    await screen.findByRole('heading', { name: 'All years' });

    navigate('#/search');
    await screen.findByRole('heading', { name: 'Search' });
    expect(screen.getByLabelText('Search published content')).toBeTruthy();

    navigate('#/pages/files');
    await screen.findByRole('heading', { name: 'Files' });
    expect(screen.getByText(/Files body/)).toBeTruthy();

    navigate('#/');
    await screen.findByText('Browse posts');

    navigate('#/admin');
    await screen.findByText('Access denied');
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });

  it('keeps navigation usable and shows honest route states when the catalog fails', async () => {
    state.dataset = state.make('error');
    render(<App />);
    await screen.findByText(/Native index site identity does not match/);

    fireEvent.click(screen.getByRole('link', { name: 'Posts' }));
    navigate('#/posts');
    await screen.findByText('Posts are unavailable');

    navigate('#/archive');
    await screen.findByText('Posts are unavailable');

    navigate('#/pages/files');
    await screen.findByText('Pages are unavailable');

    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

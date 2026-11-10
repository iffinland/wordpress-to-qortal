import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCmsRepository } from '../src/lib/repository.js';
import { cmsConfig } from '../src/config/cmsConfig';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', 'fixtures');

function fixtureResponse(input: RequestInfo | URL) {
  const url = new URL(String(input), 'http://localhost');
  const relative = decodeURIComponent(url.pathname.replace(/^\/cms-fixture\//, ''));
  try {
    const body = readFileSync(path.join(FIXTURES, relative), 'utf8');
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => JSON.parse(body)
    } as Response);
  } catch {
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({})
    } as Response);
  }
}

describe('generic CMS repository', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(fixtureResponse));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the fixture manifest, indexes and content through the real repository', async () => {
    const repository = createCmsRepository(cmsConfig, { source: 'fixture' });
    const dataset = await repository.loadDataset();
    expect(dataset.state).toBe('ready');
    expect(dataset.posts).toHaveLength(3);
    expect(dataset.pages).toHaveLength(2);
    const item = await repository.findPost('hello-qortal');
    expect(item).not.toBeNull();
    const content = await repository.loadContent(item);
    expect(content.title).toBe('Hello Qortal');
    expect(content.html).toContain('neutral fixture site');
    expect(content.html).toContain('qms-fixture-image-hero');
    const page = await repository.findPage('about');
    expect(page).not.toBeNull();
  });

  it('falls back to the cached catalog when live reads fail', async () => {
    const repository = createCmsRepository(cmsConfig, { source: 'fixture' });
    const first = await repository.loadDataset();
    expect(first.state).toBe('ready');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const second = await repository.loadDataset(true);
    expect(second.state).toBe('stale');
    expect(second.fromCache).toBe(true);
    expect(second.posts).toHaveLength(3);
    expect(second.notices.some((notice: { code: string }) => notice.code === 'catalog-cache-fallback')).toBe(true);
  });

  it('rejects a legacy cache from another hosted QDN identity instead of showing its posts', async () => {
    const developerConfig = structuredClone(cmsConfig);
    developerConfig.site.ownerName = 'developer iffi';
    const developer = createCmsRepository(developerConfig, { source: 'fixture', name: 'developer iffi' });
    const developerDataset = await developer.loadDataset();
    // This is the vulnerable v1 shape produced by the previous release: its
    // key contains only site.id, so another deployment could consume it.
    localStorage.setItem('qms-cms-dataset:' + cmsConfig.site.id, JSON.stringify({
      schema: 'qms-cms-dataset-cache@1',
      cachedAt: '2026-11-10T00:00:00.000Z',
      dataset: developerDataset
    }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const nasaConfig = structuredClone(cmsConfig);
    nasaConfig.site.ownerName = 'NASA-Official';
    nasaConfig.admin.qdnName = 'NASA-Official';
    const nasa = createCmsRepository(nasaConfig, { source: 'fixture', name: 'NASA-Official' });
    const dataset = await nasa.loadDataset();
    expect(dataset.state).toBe('error');
    expect(dataset.posts).toHaveLength(0);
    expect(dataset.notices.some((notice: { code: string }) => notice.code === 'catalog-cache-fallback')).toBe(false);
  });
});

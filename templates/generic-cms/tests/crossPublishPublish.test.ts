import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishBatch, readPending } from '../src/lib/publish.js';
import { publishNativePostDraft } from '../src/lib/authoring.js';
import { buildCrossPublishPlan } from '../src/lib/crossPublish/plan.js';
import { fallbackSubwireCover } from '../src/lib/crossPublish/subwire.js';
import { ownerIdentity } from './support/fixtures';

type Mode = 'ok' | 'qtube-failed' | 'timeout';

function install(mode: Mode) {
  const calls: any[] = [];
  const ready = new Set<string>();
  const stored = new Map<string, string>();
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    calls.push(payload);
    switch (payload.action) {
      case 'GET_USER_ACCOUNT': return { address: ownerIdentity.address };
      case 'GET_ACCOUNT_NAMES': return [{ name: 'QortalDemo' }];
      case 'GET_PRIMARY_NAME': return 'QortalDemo';
      case 'GET_QDN_RESOURCE_STATUS': return { status: ready.has(payload.identifier) ? 'READY' : 'NOT_FOUND' };
      case 'PUBLISH_MULTIPLE_QDN_RESOURCES': {
        if (mode === 'timeout') throw new Error('The Qortal request timed out.');
        const failed = mode === 'qtube-failed' ? ['qtube-metadata-id'] : [];
        for (const item of payload.resources) {
          if (failed.includes(item.identifier)) continue;
          ready.add(item.identifier);
          if (item.data64) stored.set(item.identifier, item.data64);
        }
        if (failed.length) {
          return { message: 'resources failed', error: { unsuccessfulPublishes: failed.map((identifier) => ({ identifier, service: 'DOCUMENT', reason: 'x' })) } };
        }
        return [{ signature: 's' }];
      }
      case 'PUBLISH_QDN_RESOURCE':
        ready.add(payload.identifier);
        if (payload.data64) stored.set(payload.identifier, payload.data64);
        return { signature: 's' };
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  return calls;
}

const video = {
  service: 'VIDEO', name: 'QortalDemo', identifier: 'qms-cms-att-abcdef',
  filename: 'klipp.mp4', mime: 'video/mp4', size: 123456
};

const draft = {
  id: 'cms-1', type: 'post', title: 'Cross publish test', slug: 'cross-publish-test',
  html: '<p>Body text for cross publication.</p>', excerpt: 'Summary', categoriesText: '', tagsText: '',
  author: 'Owner', sourceKind: 'cms-native', remoteId: 'cms-1', originalSlug: 'cross-publish-test'
};

async function destinationResources() {
  const plan = await buildCrossPublishPlan({
    draft,
    name: 'QortalDemo',
    siteId: 'site-fixture',
    siteTitle: 'Qortal Site',
    publisherName: 'QortalDemo',
    postUrl: 'qortal://APP/QortalDemo/#/posts/cross-publish-test',
    video,
    cover: fallbackSubwireCover({ title: draft.title, siteTitle: 'Qortal Site', accent: '#4da3ff' }),
    selections: { qtube: true, subwire: true, quitter: true },
    quitterText: '',
    timestamp: 1763000000000,
    readRemote: async () => null
  });
  return plan.resources.map((resource: any) => (resource.stage === 'qtube'
    ? { ...resource, identifier: 'qtube-metadata-id' }
    : resource));
}

const batchCalls = (calls: any[]) => calls.filter((entry) => entry.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/names/')
    ? { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) }
    : { ok: false, status: 404, json: async () => ({}) }));
});

afterEach(() => {
  delete (window as any).qortalRequest;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('cross-publication through the single publish batch', () => {
  it('sends CMS and every destination in one approved batch and verifies each stage', async () => {
    const calls = install('ok');
    const resources = [
      ...(await destinationResources()),
      { stage: 'content', identifier: 'post-content', document: { html: draft.html } }
    ];
    const result = await publishBatch({
      identity: ownerIdentity, name: 'QortalDemo', resources, storage: localStorage, verifyTimeoutMs: 500
    });
    expect(result.ok).toBe(true);
    const sent = batchCalls(calls)[0].resources;
    expect(sent.map((item: any) => item.identifier)).toContain('qtube-metadata-id');
    const qtube = sent.find((item: any) => item.identifier === 'qtube-metadata-id');
    expect(qtube.tag1).toBe('qtube_vid_');
    expect(result.results.map((entry: any) => entry.stage)).toEqual(['qtube', 'subwire', 'quitter', 'crosspost-record', 'content']);
    expect(result.results.every((entry: any) => entry.ok)).toBe(true);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('keeps the CMS verified and reports the failed destination on a partial batch', async () => {
    install('qtube-failed');
    const result: any = await publishNativePostDraft({
      identity: ownerIdentity,
      name: 'QortalDemo',
      siteId: 'site-fixture',
      draft,
      baseRevision: 0,
      storage: localStorage,
      author: 'Owner',
      timestamp: 1763000000000,
      extraResources: await destinationResources()
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('partial');
    const byStage: Record<string, any> = {};
    for (const row of result.batchResults) byStage[row.stage] = row;
    expect(byStage.content.ok).toBe(true);
    expect(byStage.index.ok).toBe(true);
    expect(byStage.search.ok).toBe(true);
    expect(byStage.subwire.ok).toBe(true);
    expect(byStage.quitter.ok).toBe(true);
    expect(byStage.qtube.ok).toBe(false);
    expect(byStage.qtube.state).toBe('failed');
  });

  it('parks an ambiguous batch per resource and never resends', async () => {
    const calls = install('timeout');
    const resources = await destinationResources();
    const first: any = await publishBatch({
      identity: ownerIdentity, name: 'QortalDemo', resources, storage: localStorage, verifyTimeoutMs: 300
    });
    expect(first.state).toBe('ambiguous');
    expect(first.results.every((entry: any) => entry.state === 'ambiguous')).toBe(true);
    expect(readPending(localStorage)).toHaveLength(resources.length);
    const second: any = await publishBatch({
      identity: ownerIdentity, name: 'QortalDemo', resources, storage: localStorage, verifyTimeoutMs: 300
    });
    expect(second.state).toBe('ambiguous');
    expect(batchCalls(calls)).toHaveLength(1);
  });
});

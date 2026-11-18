import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishBatch, readPending, verifyReady } from '../src/lib/publish.js';
import { createHash } from 'node:crypto';
import { ownerIdentity } from './support/fixtures';

type Mode = 'ok' | 'decline' | 'partial';

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
        if (mode === 'decline') throw new Error('User declined request');
        const failed = mode === 'partial' ? ['att-1'] : [];
        for (const item of payload.resources) {
          if (failed.includes(item.identifier)) continue;
          ready.add(item.identifier);
          if (item.data64) stored.set(item.identifier, item.data64);
          if (item.file) {
            const buffer = Buffer.from(await item.file.arrayBuffer());
            stored.set(item.identifier, buffer.toString('base64'));
          }
        }
        return failed.length ? { message: 'resources failed', error: { unsuccessfulPublishes: failed.map((identifier) => ({ identifier, reason: 'x', service: 'VIDEO' })) } } : [{ signature: 's' }];
      }
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  return calls;
}

const fileBytes = new Uint8Array(2048).fill(7);
const file = { size: fileBytes.length, type: 'video/mp4', arrayBuffer: async () => fileBytes.slice().buffer };
const fileSha = createHash('sha256').update(Buffer.from(fileBytes)).digest('hex');
const resources = () => [
  { stage: 'attachment', service: 'VIDEO', identifier: 'att-1', file, sha256: fileSha, filename: 'clip.mp4', title: 'Clip', reuseIfReady: true },
  { stage: 'poster', service: 'IMAGE', identifier: 'poster-1', bytes: new Uint8Array([1, 2, 3]), filename: 'poster.jpg', reuseIfReady: true },
  { stage: 'content', identifier: 'post-1', document: { html: '<p>x</p>' } }
];
const run = (onProgress?: any) => publishBatch({ identity: ownerIdentity, name: 'QortalDemo', resources: resources(), storage: localStorage, verifyTimeoutMs: 300, onProgress });
const batchCalls = (calls: any[]) => calls.filter((c) => c.action === 'PUBLISH_MULTIPLE_QDN_RESOURCES');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/names/')
    ? { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) }
    : { ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => { delete (window as any).qortalRequest; vi.unstubAllGlobals(); localStorage.clear(); });

describe('publishBatch with attachments and posters', () => {
  it('reports a resource that is still propagating as pending, not as an ambiguous byte mismatch', async () => {
    const result: any = await verifyReady({
      service: 'VIDEO',
      name: 'QortalDemo',
      identifier: 'att-1',
      expectedSha256: fileSha,
      timeoutMs: 0,
      statusFn: async () => ({ status: 'DOWNLOADING', localChunkCount: 33, totalChunkCount: 42 })
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe('pending-propagation');
    expect(result.message).toContain('still downloading');
    expect(result.message).toContain('NOT resent');
  });
  it('sends the file by reference (no base64), lists every resource and reports progress', async () => {
    const calls = install('ok');
    const progress: any[] = [];
    const result = await run((snapshot: any) => progress.push(snapshot));
    expect(result.ok).toBe(true);
    const sent = batchCalls(calls)[0].resources;
    expect(sent).toHaveLength(3);
    const att = sent.find((r: any) => r.identifier === 'att-1');
    expect(att.file).toBe(file);
    expect(att.data64).toBeUndefined();
    expect(sent.find((r: any) => r.identifier === 'poster-1').service).toBe('IMAGE');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0].map((p: any) => p.state)).toEqual(['queued', 'queued', 'queued']);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('records a decline for all resources and clears pending', async () => {
    const calls = install('decline');
    const result = await run();
    expect(result.state).toBe('declined');
    expect(batchCalls(calls)).toHaveLength(1);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('maps a failed attachment to a per-resource state and still verifies the rest', async () => {
    install('partial');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.state).toBe('partial');
    expect(result.results.map((r: any) => r.state)).toEqual(['failed', 'remote-verified', 'remote-verified']);
  });

  it('reuses an attachment that is already READY and skips it in the request', async () => {
    const calls = install('ok');
    await run();
    calls.length = 0;
    const second = await run();
    expect(second.ok).toBe(true);
    expect(batchCalls(calls)).toHaveLength(1);
    expect(batchCalls(calls)[0].resources.map((r: any) => r.identifier)).toEqual(['post-1']);
    expect(second.results[0].state).toBe('reused');
  });
});

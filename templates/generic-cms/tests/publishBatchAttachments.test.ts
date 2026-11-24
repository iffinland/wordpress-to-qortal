import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishBatch, readPending } from '../src/lib/publish.js';
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
        }
        return failed.length ? { message: 'resources failed', error: { unsuccessfulPublishes: failed.map((identifier) => ({ identifier, reason: 'x', service: 'VIDEO' })) } } : [{ signature: 's' }];
      }
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  return calls;
}

const file = new Blob([new Uint8Array(2048).fill(7)], { type: 'video/mp4' });
const resources = () => [
  { stage: 'attachment', service: 'VIDEO', identifier: 'att-1', file, sha256: 'a'.repeat(64), filename: 'clip.mp4', title: 'Clip', reuseIfReady: true },
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

it('verifies fixed-coordinate video bytes instead of silently reusing an older READY video', async () => {
  const {Blob: NodeBlob}=await import('node:buffer');
  const {Sha256}=await import('../src/lib/sha256Stream.js');
  const expected=new Uint8Array([1,2,3]);
  let remote=new Uint8Array([3,2,1]);
  let submissions=0;
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>String(input).includes('/names/')
    ? {ok:true,json:async()=>({name:'QortalDemo',owner:ownerIdentity.address})}
    : {ok:true,body:new ReadableStream({start(controller){controller.enqueue(remote);controller.close();}})}));
  (window as any).qortalRequest=async(payload:any)=>{
    if(payload.action==='GET_USER_ACCOUNT')return {address:ownerIdentity.address};
    if(payload.action==='GET_ACCOUNT_NAMES')return [{name:'QortalDemo'}];
    if(payload.action==='GET_NAME_DATA')return {name:'QortalDemo',owner:ownerIdentity.address};
    if(payload.action==='GET_PRIMARY_NAME')return 'QortalDemo';
    if(payload.action==='GET_QDN_RESOURCE_STATUS')return {status:'READY'};
    if(payload.action==='PUBLISH_MULTIPLE_QDN_RESOURCES'){
      submissions++;remote=new Uint8Array(await payload.resources[0].file.arrayBuffer());return [{signature:'updated-video'}];
    }
    return null;
  };
  const input={identity:ownerIdentity,name:'QortalDemo',storage:localStorage,resources:[{
    stage:'attachment',service:'VIDEO',identifier:'qtube_vid_fixed',filename:'replacement.mp4',file:new NodeBlob([expected]),
    sha256:new Sha256().update(expected).hex(),reuseIfReady:true,verifyFileHash:true
  }]};
  const replaced=await publishBatch(input);
  expect(replaced.ok).toBe(true);expect(submissions).toBe(1);
  const reused=await publishBatch(input);
  expect(reused.ok).toBe(true);expect(reused.results[0].state).toBe('reused');expect(submissions).toBe(1);
});


it('includes a shared featured-image/poster resource once and refuses conflicting duplicates before signing', async () => {
  const calls=install('ok');
  const shared={stage:'media',service:'IMAGE',identifier:'poster-1',bytes:new Uint8Array([1,2,3]),filename:'featured.jpg',reuseIfReady:true};
  const result=await publishBatch({identity:ownerIdentity,name:'QortalDemo',storage:localStorage,resources:[...resources(),shared]});
  expect(result.ok).toBe(true);expect(batchCalls(calls)[0].resources.filter((r:any)=>r.identifier==='poster-1')).toHaveLength(1);
  calls.length=0;
  const conflict=await publishBatch({identity:ownerIdentity,name:'QortalDemo',storage:localStorage,resources:[shared,{...shared,bytes:new Uint8Array([9])}]});
  expect(conflict.state).toBe('failed');expect(conflict.message).toContain('Different payloads');expect(batchCalls(calls)).toHaveLength(0);
});

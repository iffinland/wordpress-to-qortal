import { describe, it, expect } from 'vitest';
import { Blob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { createAttachmentStore } from '../src/lib/attachmentStore.js';
import { preparePostAttachments } from '../src/lib/attachmentPublication.js';
import { Sha256 } from '../src/lib/sha256Stream.js';
const name = 'QortalDemo';
const bytes = new Uint8Array([1, 2, 3, 4]);
const hash = new Sha256().update(bytes).hex();
function file(kind = 'video', service = 'VIDEO', filename = 'manual.mp4') {
  return { kind, service, name, identifier: 'qms-cms-att-' + hash.slice(0, 32), filename, title: 'Manual', mime: kind === 'video' ? 'video/mp4' : '', size: 4, sha256: hash, poster: '', posterIdentifier: '', blob: new Blob([bytes]) };
}
function html(meta: any) {
  return '<p>Keep my text</p><div data-qms-attachment="1" ' + Object.entries(meta).filter(([key]) => !['blob','posterIdentifier'].includes(key)).map(([key,value]) => `data-${key}="${value}"`).join(' ') + '></div>';
}
const absent = async () => ({status:'NOT_PUBLISHED'});
const ready = async () => ({status:'READY'});

describe('attachment preparation before approval', () => {
  it.each([['video','VIDEO','manual.mp4'], ['audio','AUDIO','song.mp3'], ['text','FILE','guide.pdf'], ['archive','FILE','bundle.zip'], ['document','FILE','notes.docx']])('prepares a fresh %s without base64 or an extra publication', async (kind,service,filename) => {
    const capture=file(kind,service,filename); const store=new Map([[capture.identifier,capture]]);
    const prepared=await preparePostAttachments({html:html(capture),name,store,status:absent});
    expect(prepared.resources).toHaveLength(1);
    expect(prepared.resources[0].file).toBe(capture.blob);
    expect(prepared.resources[0].service).toBe(service);
  });
  it('keeps source bytes while mapping each video to its Q-Tube target exactly once', async () => {
    const first=file(); const second={...file(),identifier:'second-video',filename:'second.mp4'};
    const input=html(first)+html(first)+html(second);
    const prepared=await preparePostAttachments({html:input,name,store:new Map([[first.identifier,first],[second.identifier,second]]),moves:[{from:first.identifier,to:'qtube_vid_first'},{from:second.identifier,to:'qtube_vid_second'}],status:absent});
    expect(prepared.resources.map((r:any)=>r.identifier)).toEqual(['qtube_vid_first','qtube_vid_second']);
    expect(prepared.html).not.toContain(`data-identifier="${first.identifier}"`);
    expect(prepared.sourceHtml).toBe(input);
  });
  it('can edit an existing remote video and replace its poster without the video file', async () => {
    const meta={...file(),poster:'new-poster'};
    const capture={...meta,blob:null,posterIdentifier:'new-poster',poster:{bytes:new Uint8Array([7]),filename:'cover.jpg'}};
    const prepared=await preparePostAttachments({html:html(meta),name,store:new Map([[meta.identifier,capture]]),status:ready});
    expect(prepared.resources.map((r:any)=>r.stage)).toEqual(['poster']);
  });
  it('retains an existing published video and poster when neither needs uploading', async () => {
    const meta={...file(),poster:'remote-poster'};
    expect((await preparePostAttachments({html:html(meta),name,store:new Map(),status:ready})).resources).toEqual([]);
  });
  it('downloads and hashes an existing source video before publishing under a new Q-Tube coordinate', async () => {
    const meta=file(); let downloads=0;
    const prepared=await preparePostAttachments({html:html(meta),name,store:new Map(),moves:[{from:meta.identifier,to:'qtube_vid_new'}],status:async (_service:string,_name:string,id:string)=>({status:id===meta.identifier?'READY':'NOT_PUBLISHED'}),download:async()=>{downloads++;return meta.blob;}});
    expect(downloads).toBe(1);expect(prepared.resources[0].identifier).toBe('qtube_vid_new');expect(prepared.resources[0].sha256).toBe(hash);
  });
  it('reuses an already published Q-Tube destination without downloading the original', async () => {
    const meta=file();
    const prepared=await preparePostAttachments({html:html(meta),name,store:new Map(),moves:[{from:meta.identifier,to:'qtube_vid_new'}],status:ready,matches:async()=>true,download:async()=>{throw Error('unexpected download');}});
    expect(prepared.resources).toHaveLength(0);
  });
  it('does not accept an older READY target when a restored draft references a different video', async () => {
    const meta=file(); let downloaded=false;
    const prepared=await preparePostAttachments({html:html(meta),name,store:new Map(),moves:[{from:meta.identifier,to:'qtube_vid_old'}],status:ready,matches:async()=>false,download:async()=>{downloaded=true;return meta.blob;}});
    expect(downloaded).toBe(true);expect(prepared.resources[0].sha256).toBe(hash);
  });
  it('starts loading existing QDN files and reports propagation separately from a lost local file', async () => {
    const calls:any[]=[];
    const check=preparePostAttachments({html:html(file()),name,store:new Map(),status:async(...args:any[])=>{calls.push(args);return {status:'PUBLISHED'};}});
    await expect(check).rejects.toThrow(/still loading on QDN/);
    expect(calls[0][3]).toEqual({build:true});
  });
  it('fails before approval for missing files, posters, revoked handles, mismatches and foreign publishers', async () => {
    const meta=file();
    await expect(preparePostAttachments({html:html(meta),name,store:new Map(),status:absent})).rejects.toThrow(/saved local file/);
    await expect(preparePostAttachments({html:html({...meta,poster:'missing-poster'}),name,store:new Map(),status:async (s:string)=>({status:s==='VIDEO'?'READY':'MISSING'})})).rejects.toThrow(/poster/);
    const revoked={...meta,blob:{size:4,slice(){throw Error('Revoked device file');}}};
    await expect(preparePostAttachments({html:html(meta),name,store:new Map([[meta.identifier,revoked]]),status:absent})).rejects.toThrow(/Revoked/);
    await expect(preparePostAttachments({html:html(meta),name:'OtherOwner',store:new Map(),status:ready})).rejects.toThrow(/different QDN name/);
    await expect(preparePostAttachments({html:html({...meta,sha256:'b'.repeat(64)}),name,store:new Map([[meta.identifier,meta]]),status:absent})).rejects.toThrow(/does not match/);
  });
});

describe('durable attachment drafts', () => {
  it('restores binary data and poster after closing/reopening; other accounts and deployments cannot read it', async () => {
    const factory=new IDBFactory();const scope='APP:QortalDemo:default:site:owner';
    const original=createAttachmentStore(scope,factory);const capture={...file(),posterIdentifier:'saved-poster',poster:{bytes:new Uint8Array([9]),filename:'poster.jpg'}};
    expect(await original.save(capture)).toBe(true);await original.close();
    const restored=createAttachmentStore(scope,factory);await restored.ready;
    expect(new Uint8Array(await restored.get(capture.identifier).blob.arrayBuffer())).toEqual(bytes);
    expect(Array.from(restored.get(capture.identifier).poster.bytes)).toEqual([9]);
    for(const otherScope of ['APP:QortalDemo:default:site:other','WEBSITE:QortalDemo:default:site:owner','']){
      const other=createAttachmentStore(otherScope,factory);await other.ready;expect(other.size).toBe(0);await other.close();
    }
    await restored.close();
  });
  it('retains captures after a cancelled/failed publication and removes them only on explicit cleanup', async () => {
    const factory=new IDBFactory();const first=createAttachmentStore('scope',factory);const capture=file();await first.save(capture);await first.close();
    const retry=createAttachmentStore('scope',factory);await retry.ready;
    expect((await preparePostAttachments({html:html(capture),name,store:retry,status:absent})).resources).toHaveLength(1);
    await retry.prune([]);await retry.close();
    const after=createAttachmentStore('scope',factory);await after.ready;expect(after.size).toBe(0);await after.close();
  });
  it('keeps an in-session file when browser storage is unavailable, without claiming it is durable', async () => {
    const store=createAttachmentStore('owner',null);const capture=file();expect(await store.save(capture)).toBe(false);
    expect((await preparePostAttachments({html:html(capture),name,store,status:absent})).resources).toHaveLength(1);
  });
});

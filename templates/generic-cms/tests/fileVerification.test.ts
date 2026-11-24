import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishedFileMatches } from '../src/lib/fileVerification.js';
import { Sha256 } from '../src/lib/sha256Stream.js';
afterEach(()=>vi.unstubAllGlobals());
describe('replacing a video at fixed Q-Tube coordinates',()=>{
  const bytes=new Uint8Array([1,2,3]);const sha256=new Sha256().update(bytes).hex();
  function response(chunks:Uint8Array[]){return {ok:true,body:new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}})};}
  it('checks every streamed chunk and accepts the expected size and hash',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response([bytes.slice(0,1),bytes.slice(1)])));
    expect(await publishedFileMatches({service:'VIDEO',name:'QortalDemo',identifier:'qtube_vid_test',size:3,sha256})).toBe(true);
  });
  it('does not reuse an older READY video with a different hash or size',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response([new Uint8Array([3,2,1])])));
    expect(await publishedFileMatches({service:'VIDEO',name:'QortalDemo',identifier:'qtube_vid_test',size:3,sha256})).toBe(false);
    vi.stubGlobal('fetch',vi.fn(async()=>response([new Uint8Array([1,2,3,4])])));
    expect(await publishedFileMatches({service:'VIDEO',name:'QortalDemo',identifier:'qtube_vid_test',size:3,sha256})).toBe(false);
  });
  it('keeps unavailable or interrupted reads unconfirmed',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Network unavailable');}));
    expect(await publishedFileMatches({service:'VIDEO',name:'QortalDemo',identifier:'qtube_vid_test',size:3,sha256})).toBe(false);
  });
});
